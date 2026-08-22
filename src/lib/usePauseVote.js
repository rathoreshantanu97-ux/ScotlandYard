import { useState, useEffect, useCallback } from "react";
import * as api from "./supabaseApi.js";
import { supabase } from "./supabaseClient.js";

// ---------------------------------------------------------------------------
// usePauseVote — mirrors useEndGameVote exactly (same proposal/vote
// pattern, different table). See that file's comments for the shared
// reasoning.
//
// v3.42 -- REALTIME, not poll-only anymore. The 2s poll below used to be
// the ONLY way another player's vote tick or a new proposal showed up on
// your screen, which meant up to 2s of visible lag -- reported directly
// from live playtesting. A Postgres realtime subscription on both
// pause_proposals and pause_votes (filtered to this room) now triggers
// an immediate refresh() the moment either table changes, same pattern
// LobbyScreen already uses for seat/room changes. The poll stays as a
// resilience fallback (missed realtime event, reconnect gap) but is no
// longer what the UI actually depends on for responsiveness.
// ---------------------------------------------------------------------------
export function usePauseVote({ roomId, myPlayerId, mySecret }) {
  const [proposal, setProposal] = useState(null);
  const [statusList, setStatusList] = useState([]);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      const p = await api.getActivePauseProposal(roomId);
      setProposal(p);
      if (p) {
        const list = await api.getVoteStatusList({ roomId, voteTable: "pause_votes", proposalId: p.proposalId });
        setStatusList(list);
      } else {
        setStatusList([]);
      }
    } catch (e) {
      console.error("Failed to fetch pause proposal:", e);
    }
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [roomId, refresh]);

  // pause_votes has no room_id column of its own (only proposal_id), so
  // that half of the subscription can't be filtered server-side the way
  // pause_proposals can -- it's subscribed unfiltered and every insert
  // just triggers this room's own refresh() (which is itself correctly
  // scoped), same cost as one extra no-op refresh whenever ANY room's
  // vote lands. Negligible at this app's scale.
  useEffect(() => {
    if (!supabase || !roomId) return;
    const channel = supabase
      .channel(`pause_vote:${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pause_proposals", filter: `room_id=eq.${roomId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "pause_votes" }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, refresh]);

  const propose = useCallback(async () => {
    setErr("");
    try {
      await api.proposePause({ roomId, callerPlayerId: myPlayerId, callerSecret: mySecret });
      await refresh();
    } catch (e) {
      setErr(e.message || "Failed to propose pausing.");
      throw e;
    }
  }, [roomId, myPlayerId, mySecret, refresh]);

  const vote = useCallback(
    async (voteValue) => {
      if (!proposal) return;
      setErr("");
      try {
        await api.votePause({
          roomId,
          callerPlayerId: myPlayerId,
          callerSecret: mySecret,
          proposalId: proposal.proposalId,
          vote: voteValue,
        });
        await refresh();
      } catch (e) {
        setErr(e.message || "Failed to submit your vote.");
        throw e;
      }
    },
    [roomId, myPlayerId, mySecret, proposal, refresh]
  );

  const iHaveVoted = proposal ? proposal.votedPlayerIds.includes(myPlayerId) : false;

  return { proposal, statusList, err, propose, vote, iHaveVoted };
}
