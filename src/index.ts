import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  Interaction,
  PermissionFlagsBits,
  WebhookClient,
  ChannelType,
  Message,
} from "discord.js";
import { readFileSync } from "fs";
import { token, clientId, guildId } from "@/lib/exports";
import chalk from "chalk";
import {
  loadLinkHistoryFromJsonBin,
  saveLinkHistoryToJsonBin,
} from "@/jsonbin";

if (!token || !clientId || !guildId || !process.env.LOG_WEBHOOK_URL) {
  throw new Error("❌ Missing required environment variables.");
}

const logWebhook = new WebhookClient({ url: process.env.LOG_WEBHOOK_URL! });
const maxLinks = 4;
const linkCooldown = 2 * 60 * 60 * 1000;
let linkHistoryCache: Record<string, any> = {};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User],
  presence: {
    activities: [{ name: "lunaar.org", type: 0 }],
    status: "dnd",
  },
});

const commands = [
  new SlashCommandBuilder()
    .setName("sendlinkembed")
    .setDescription("Sends a link embed with a button")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
];

const rest = new REST({ version: "10" }).setToken(token);

function getRemainingCooldownTime(userId: string): number {
  const last = linkHistoryCache[userId]?.lastPeriodStartTime || 0;
  const since = Date.now() - last;
  return since >= linkCooldown ? 0 : linkCooldown - since;
}

function formatCooldownTime(ms: number): string {
  const hrs = Math.floor(ms / (1000 * 60 * 60));
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${hrs} hours and ${mins} minutes`;
}

function getUserLinkCount(userId: string): number {
  return linkHistoryCache[userId]?.currentPeriodCount || 0;
}

async function getRandomUniqueLink(
  userId: string
): Promise<string | { error: string }> {
  const links = readFileSync("./links.txt", "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (!linkHistoryCache[userId]) {
    linkHistoryCache[userId] = {
      history: [],
      currentPeriodCount: 0,
      lastPeriodStartTime: Date.now(),
    };
  }

  const now = Date.now();
  const last = linkHistoryCache[userId].lastPeriodStartTime;
  if (now - last >= linkCooldown) {
    linkHistoryCache[userId].currentPeriodCount = 0;
    linkHistoryCache[userId].lastPeriodStartTime = now;
  }

  if (linkHistoryCache[userId].currentPeriodCount >= maxLinks) {
    return {
      error: `you have already received ${maxLinks} links in the last 2 hours. Please try again in ${formatCooldownTime(
        getRemainingCooldownTime(userId)
      )}.`,
    };
  }

  const available = links.filter(
    (l) => !linkHistoryCache[userId].history.includes(l)
  );
  if (available.length === 0) {
    return {
      error:
        "You have already received all available links. Please check back later.",
    };
  }

  const choice = available[Math.floor(Math.random() * available.length)];
  linkHistoryCache[userId].history.push(choice);
  linkHistoryCache[userId].currentPeriodCount++;
  if (linkHistoryCache[userId].currentPeriodCount === 1) {
    linkHistoryCache[userId].lastPeriodStartTime = now;
  }

  await saveLinkHistoryToJsonBin(linkHistoryCache);
  return choice;
}

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });
    console.log(chalk.green("✅ Slash command registered."));
    linkHistoryCache = await loadLinkHistoryFromJsonBin();
  } catch (err) {
    console.error(
      chalk.red("❌ Failed to register commands or load link history:"),
      err
    );
  }
})();

client.once(Events.ClientReady, () => {
  console.log(chalk.blue(`✅ Logged in as ${client.user?.tag}`));
});

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;
  if (message.channel.type === ChannelType.DM) {
    const userTag = message.author.tag;
    const userId = message.author.id;
    const content = message.content || "[embed/attachment]";
    await logWebhook.send(
      `📩 DM received from ${userTag} (${userId}):\n${content}`
    );
  }
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === "sendlinkembed") {
    const embed = new EmbedBuilder()
      .setTitle("Lunaar Link Generator")
      .setDescription(
        "Click the button below to receive a link in your DMs.\n\n*Limited to 4 links per 2 hours.*"
      )
      .setColor(0x5865f2);
    const button = new ButtonBuilder()
      .setCustomId("lunaar_button")
      .setLabel("Lunaar Links")
      .setEmoji("1369509638956908674")
      .setStyle(ButtonStyle.Primary);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
    await interaction.reply({ embeds: [embed], components: [row] });
    await logWebhook.send(`↩️ sendlinkembed used by ${interaction.user.tag}`);
    return;
  }

  if (!interaction.isButton() || interaction.customId !== "lunaar_button") return;

  const userTag = interaction.user.tag;
  const userId = interaction.user.id;

  await logWebhook.send(`🔘 Button clicked by ${userTag} (${userId})`);
  await interaction.deferReply({ ephemeral: true });
  const result = await getRandomUniqueLink(userId);

  if (typeof result === "object" && result.error) {
    await interaction.editReply({ content: `❌ ${result.error}` });
    await logWebhook.send(
      `↩️ Replied to ${userTag} with error: ${result.error}`
    );
    return;
  }

  const link = result as string;
  const remaining = maxLinks - getUserLinkCount(userId);
  const replyContent = `✅ Check your DMs! You have ${remaining} link${
    remaining !== 1 ? "s" : ""
  } remaining for the next 2 hours.`;
  await interaction.editReply({ content: replyContent });
  await logWebhook.send(`↩️ Replied to ${userTag}: "${replyContent}"`);

  const emoji =
    client.emojis.cache.get("1369509638956908674")?.toString() ?? "";
  const dmContent = `${emoji} Here's your new [Lunaar link](${link}) Do not share it ${emoji}`;
  await interaction.user.send(dmContent);
  await logWebhook.send(`✉️ Sent DM to ${userTag}: "${dmContent}"`);

});

client.login(token);
