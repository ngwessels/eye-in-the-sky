import { v4 as uuidv4 } from "uuid";
import { getDb } from "./mongodb";
import type { CommandDoc, CommandType } from "./types";

export async function enqueueCommand(input: {
  stationId: string;
  type: CommandType;
  payload: Record<string, unknown>;
  ttlMs?: number;
  trace_id?: string;
  parent_command_id?: string;
  watch_target?: Record<string, unknown>;
  selection_reason?: string;
  followup_depth?: number;
}): Promise<CommandDoc> {
  const db = await getDb();
  const now = new Date();
  const ttl = input.ttlMs ?? 24 * 60 * 60 * 1000;
  const doc: CommandDoc = {
    commandId: uuidv4(),
    stationId: input.stationId,
    type: input.type,
    payload: input.payload,
    state: "pending",
    createdAt: now,
    expiresAt: new Date(now.getTime() + ttl),
    trace_id: input.trace_id,
    parent_command_id: input.parent_command_id,
    watch_target: input.watch_target,
    selection_reason: input.selection_reason,
    followup_depth: input.followup_depth,
  };
  await db.collection<CommandDoc>("commands").insertOne(doc);
  return doc;
}
