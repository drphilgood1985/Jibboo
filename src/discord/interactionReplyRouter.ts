import type {
  ChatInputCommandInteraction,
  InteractionDeferReplyOptions,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  MessageCreateOptions
} from "discord.js";

type ReplyPayload = Parameters<ChatInputCommandInteraction["reply"]>[0];
type EditReplyPayload = Parameters<ChatInputCommandInteraction["editReply"]>[0];
type FollowUpPayload = Parameters<ChatInputCommandInteraction["followUp"]>[0];
type PublicPayload = ReplyPayload | EditReplyPayload | FollowUpPayload;

type SendableTextChannel = {
  isTextBased: () => boolean;
  send: (payload: string | MessageCreateOptions) => Promise<unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toMessageCreatePayload(payload: PublicPayload): string | MessageCreateOptions {
  if (typeof payload === "string") {
    return payload;
  }

  if (!isRecord(payload)) {
    return { content: String(payload) };
  }

  const {
    ephemeral: _ephemeral,
    fetchReply: _fetchReply,
    flags: _flags,
    withResponse: _withResponse,
    ...messagePayload
  } = payload;

  return messagePayload as MessageCreateOptions;
}

function isSendableTextChannel(channel: unknown): channel is SendableTextChannel {
  return (
    isRecord(channel) &&
    typeof channel.isTextBased === "function" &&
    channel.isTextBased() &&
    typeof channel.send === "function"
  );
}

async function findPostChannel(
  interaction: ChatInputCommandInteraction,
  postChannelId: string
): Promise<SendableTextChannel | null> {
  const cached = interaction.guild?.channels.cache.get(postChannelId);
  if (isSendableTextChannel(cached)) {
    return cached;
  }

  const fetched = await interaction.guild?.channels.fetch(postChannelId).catch(() => null);
  if (isSendableTextChannel(fetched)) {
    return fetched;
  }

  return null;
}

async function sendPublicMessage(
  interaction: ChatInputCommandInteraction,
  postChannelId: string,
  payload: PublicPayload
): Promise<boolean> {
  const channel = await findPostChannel(interaction, postChannelId);
  if (!channel) {
    return false;
  }

  try {
    await channel.send(toMessageCreatePayload(payload));
    return true;
  } catch (error) {
    console.error(`Failed to send command response to channel ${postChannelId}:`, error);
    return false;
  }
}

export function routePublicRepliesToChannel(
  interaction: ChatInputCommandInteraction,
  postChannelId: string
): ChatInputCommandInteraction {
  if (interaction.channelId === postChannelId) {
    return interaction;
  }

  let acknowledgedInteraction = false;

  const acknowledgeInteraction = async (): Promise<void> => {
    if (acknowledgedInteraction || interaction.deferred || interaction.replied) {
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    acknowledgedInteraction = true;
  };

  const deleteAcknowledgement = async (): Promise<void> => {
    try {
      await interaction.deleteReply();
    } catch {
      // The response was only a transport acknowledgement. Nothing else should be posted here.
    }
  };

  const sendAndClear = async (payload: PublicPayload): Promise<void> => {
    await acknowledgeInteraction();
    const sent = await sendPublicMessage(interaction, postChannelId, payload);

    if (!sent) {
      console.error(`Could not post command response in channel ${postChannelId}.`);
    }

    await deleteAcknowledgement();
  };

  const proxyMethods = {
    async reply(payload: ReplyPayload): Promise<unknown> {
      await sendAndClear(payload);
      return undefined;
    },

    async deferReply(options?: InteractionDeferReplyOptions): Promise<unknown> {
      acknowledgedInteraction = true;
      return interaction.deferReply({
        ...(isRecord(options) ? options : {}),
        ephemeral: true
      } as InteractionDeferReplyOptions);
    },

    async editReply(payload: EditReplyPayload): Promise<unknown> {
      await sendAndClear(payload);
      return undefined;
    },

    async followUp(payload: FollowUpPayload): Promise<unknown> {
      await sendAndClear(payload);
      return undefined;
    }
  };

  return new Proxy(interaction, {
    get(target, property, receiver) {
      if (property in proxyMethods) {
        return proxyMethods[property as keyof typeof proxyMethods];
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
