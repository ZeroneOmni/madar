import * as Schema from "effect/Schema";

import { ChatAttachment } from "./chatAttachment.ts";
import { GuestMessageId, GuestShareId, IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * A guest share lets one unauthenticated browser watch a thread over Madar Connect and propose
 * messages the owner must send or dismiss. The thread projection holds this public state; the
 * credentials are derived from the share id with a server key and never stored.
 */

export const GUEST_MESSAGE_MAX_LENGTH = 4_000;
export const GUEST_NAME_MAX_LENGTH = 40;

/** Resolved messages kept so the guest can see what happened to what they sent. */

/** Files a guest can attach to one message, and their total size. */

/** Total size of the files in a share's waiting messages, so a guest cannot fill the disk. */

export const ThreadGuestMessageStatus = Schema.Literals(["pending", "sent", "dismissed"]);
export type ThreadGuestMessageStatus = typeof ThreadGuestMessageStatus.Type;

export const ThreadGuestMessage = Schema.Struct({
  id: GuestMessageId,
  text: Schema.String,
  status: ThreadGuestMessageStatus,
  submittedAt: IsoDateTime,
  /** The thread's attachments, deleted if the message is dismissed. Absent on older messages. */
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
});
export type ThreadGuestMessage = typeof ThreadGuestMessage.Type;

export const ThreadGuestShare = Schema.Struct({
  id: GuestShareId,
  /** The Madar Connect tunnel hostname the link points at. Guest routes require it to still serve. */
  host: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
  /** Set once, when the guest redeems the link. */
  guestName: Schema.NullOr(TrimmedNonEmptyString),
  messages: Schema.Array(ThreadGuestMessage),
});
export type ThreadGuestShare = typeof ThreadGuestShare.Type;
