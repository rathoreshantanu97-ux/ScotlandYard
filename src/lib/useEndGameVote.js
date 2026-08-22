import { useState, useEffect, useCallback } from "react";
import * as api from "./supabaseApi.js";
import { supabase } from "./supabaseClient.js";

// ---------------------------------------------------------------------------
// useEndGameVote — v3.42: realtime, not poll-only. A Postgres realtime
// subscription on end_game_proposals (filtered to this room) and
// end_game_votes (unfiltered -- that table has no room_id column of its
// own, only proposal_id) triggers an immediate refresh() the moment
// either changes, addressing reported lag where another player's vote
// took up to 2s to show up. The poll below stays as a resilience
// fallback for a missed realtime event or a reconnect gap.
// ---------------------------------------------------------------------------
export function useEndGameVote({ roomId, myPlayerId, mySecret }) {
  const [proposal, setProposal] = useState(null);
  const [statusList, setStatusList] = useState([]);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      const p = await api.getActiveEndGameProposal(roomId);
      setProposal(p);
      if (p) {
        const list = await api.getVoteStatusList({ roomId, voteTable: "end_game_votes", proposalId: p.proposalId });
        setStatusList(list);
      } else {
        setStatusList([]);
      }
    } catch (e) {
      console.error("Failed to fetch end-game proposal:", e);
    }
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [roomId, refresh]);

  useEffect(() => {
    if (!supabase || !roomId) return;
    const channel = supabase
      .channel(`end_game_vote:${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "end_game_proposals", filter: `room_id=eq.${roomId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "end_game_votes" }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, refresh]);

  const propose = useCallback(async () => {
    setErr("");
    try {
      await api.proposeEndGame({ roomId, callerPlayerId: myPlayerId, callerSecret: mySecret });
      await refresh();
    } catch (e) {
      setErr(e.message || "Failed to propose ending the game.");
      throw e;
    }
  }, [roomId, myPlayerId, mySecret, refresh]);

  const vote = useCallback(
    async (voteValue) => {
      if (!proposal) return;
      setErr("");
      try {
        await api.voteEndGame({
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
