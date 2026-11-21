import type { CardSettings } from "./postcard";
export type Effect = {
  name: string;
  x: number;
  y: number;
  size: number;
  include: boolean;
};
export type Editor = CardSettings & { effect?: Effect };
export type Member = {
  uid: string;
  seat: "host" | "guest";
  name: string;
  style: number;
  strength: number;
  intended_shot: number | null;
  ready: boolean;
  live: boolean;
  approved: number | null;
};
export type Round = {
  acks: string[];
  id: string;
  at: string;
  status: "pending" | "done" | "cancelled";
  shot: number;
  attempt: number;
  visual: { editor: Editor; members: Member[] };
};
export type Snapshot = {
  room: {
    id: string;
    title: string;
    host: string;
    adult: boolean;
    layout: string;
    expires: string;
    revision: number;
    editor: Editor;
    matched: boolean;
  };
  members: Member[];
  me: string;
  round: Round | null;
  now: string;
};
export const noEffect: Effect = {
  name: "Off",
  x: 0.5,
  y: 0.5,
  size: 0.25,
  include: false,
};
