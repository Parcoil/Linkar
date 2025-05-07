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
} from "discord.js";
import { readFileSync } from "fs";
import fetch from "node-fetch";
import dotenv from "dotenv";
import chalk from "chalk";

dotenv.config();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const dropboxToken = process.env.DROPBOX_TOKEN;

if (!token || !clientId || !guildId || !dropboxToken) {
  throw new Error("❌ Missing required environment variables.");
}

const maxLinks = 4;
const linkCooldown = 12 * 60 * 60 * 1000;

let linkHistoryCache: any = {};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel, Partials.Message, Partials.User],
  presence: {
    activities: [
      {
        name: "lunaar.org",
        type: 0,
      },
    ],
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

async function loadLinkHistoryFromDropbox(): Promise<void> {
  try {
    const response = await fetch(
      "https://content.dropboxapi.com/2/files/download",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${dropboxToken}`,
          "Dropbox-API-Arg": JSON.stringify({
            path: "/link_history.json",
          }),
        },
      }
    );

    if (response.ok) {
      const data = await response.text();

      if (!data || data.trim() === "") {
        console.log("🔍 Empty link history file found, starting fresh");
        linkHistoryCache = {};
        return;
      }

      try {
        linkHistoryCache = JSON.parse(data);
        console.log("✅ Link history loaded from Dropbox");
      } catch (parseError) {
        console.error("❌ Failed to parse link history JSON:", parseError);
        console.log("🔄 Initializing fresh link history cache");
        linkHistoryCache = {};

        await saveLinkHistoryToDropbox();
      }
    } else if (response.status === 409) {
      linkHistoryCache = {};
      console.log("🔍 No existing link history found, starting fresh");
    } else {
      console.error(
        `❌ Failed to load link history: ${response.status} ${response.statusText}`
      );
      linkHistoryCache = {};
    }
  } catch (err) {
    console.error("❌ Error loading link history:", err);
    linkHistoryCache = {};
  }
}

async function saveLinkHistoryToDropbox(): Promise<void> {
  try {
    const response = await fetch(
      "https://content.dropboxapi.com/2/files/upload",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${dropboxToken}`,
          "Dropbox-API-Arg": JSON.stringify({
            path: "/link_history.json",
            mode: "overwrite",
          }),
          "Content-Type": "application/octet-stream",
        },
        body: JSON.stringify(linkHistoryCache),
      }
    );

    if (response.ok) {
      console.log(chalk.green("✅ Link history saved to Dropbox"));
    } else {
      console.error(
        chalk.red(
          `❌ Failed to save link history: ${response.status} ${response.statusText}`
        )
      );
    }
  } catch (err) {
    console.error(chalk.red("❌ Error saving link history:"), err);
  }
}

function getRemainingCooldownTime(userId: string): number {
  if (!linkHistoryCache[userId] || !linkHistoryCache[userId].history) {
    return 0;
  }

  const lastLinkTime = linkHistoryCache[userId].lastPeriodStartTime || 0;
  const currentTime = Date.now();

  const timeSincePeriodStart = currentTime - lastLinkTime;

  if (timeSincePeriodStart >= linkCooldown) {
    return 0;
  }

  return linkCooldown - timeSincePeriodStart;
}

function formatCooldownTime(milliseconds: number): string {
  const hours = Math.floor(milliseconds / (1000 * 60 * 60));
  const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));

  return `${hours} hours and ${minutes} minutes`;
}

function getUserLinkCount(userId: string): number {
  if (
    !linkHistoryCache[userId] ||
    !linkHistoryCache[userId].currentPeriodCount
  ) {
    return 0;
  }
  return linkHistoryCache[userId].currentPeriodCount;
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

  const currentTime = Date.now();
  const lastLinkTime = linkHistoryCache[userId].lastPeriodStartTime || 0;
  const timeSincePeriodStart = currentTime - lastLinkTime;

  if (timeSincePeriodStart >= linkCooldown) {
    linkHistoryCache[userId].currentPeriodCount = 0;
    linkHistoryCache[userId].lastPeriodStartTime = currentTime;
  }

  if (linkHistoryCache[userId].currentPeriodCount >= maxLinks) {
    const cooldownTimeRemaining = getRemainingCooldownTime(userId);
    return {
      error: `you have already received ${maxLinks} links in the last 12 hours. Please try again in ${formatCooldownTime(
        cooldownTimeRemaining
      )}.`,
    };
  }

  const availableLinks = links.filter(
    (link) => !linkHistoryCache[userId].history.includes(link)
  );

  if (availableLinks.length === 0) {
    return {
      error:
        "You have already received all available links. Please check back later.",
    };
  }

  const randomLink =
    availableLinks[Math.floor(Math.random() * availableLinks.length)];

  linkHistoryCache[userId].history.push(randomLink);
  linkHistoryCache[userId].currentPeriodCount++;

  if (linkHistoryCache[userId].currentPeriodCount === 1) {
    linkHistoryCache[userId].lastPeriodStartTime = currentTime;
  }

  await saveLinkHistoryToDropbox();

  return randomLink;
}

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });
    console.log(chalk.green("✅ Slash command registered."));

    await loadLinkHistoryFromDropbox();
  } catch (err) {
    console.error(
      chalk.red("❌ Failed to register commands or load link history:", err)
    );
  }
})();

client.once(Events.ClientReady, () => {
  console.log(chalk.blue(`✅ Logged in as ${client.user?.tag}`));
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "sendlinkembed"
  ) {
    const embed = new EmbedBuilder()
      .setTitle("Lunaar Link Generator")
      .setDescription(
        "Click the button below to receive a link in your DMs.\n\n*Limited to 2 links per 12 hours.*"
      )
      .setColor(0x5865f2);

    const button = new ButtonBuilder()
      .setCustomId("lunaar_button")
      .setLabel("Lunaar Links")
      .setEmoji("1369509638956908674")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

    await interaction.reply({ embeds: [embed], components: [row] });
  }

  if (interaction.isButton() && interaction.customId === "lunaar_button") {
    try {
      await interaction.deferReply({ ephemeral: true });

      const userId = interaction.user.id;
      const randomLinkResult = await getRandomUniqueLink(userId);
      const getLunaarEmoji = client.emojis.cache.get("1369509638956908674");
      const lunaarEmoji = getLunaarEmoji?.toString();

      if (typeof randomLinkResult === "object" && randomLinkResult.error) {
        await interaction.editReply({
          content: `❌ ${randomLinkResult.error}`,
        });
        return;
      }

      const randomLink = randomLinkResult as string;

      try {
        await interaction.user.send(
          `${lunaarEmoji} Here's your new [Lunaar link](${randomLink}) Do not share it ${lunaarEmoji}`
        );

        const linksUsed = getUserLinkCount(userId);
        const remainingLinks = maxLinks - linksUsed;

        await interaction.editReply({
          content: `✅ Check your DMs! You have ${remainingLinks} link${
            remainingLinks !== 1 ? "s" : ""
          } remaining for the next 12 hours.`,
        });

        console.log(
          `User ${interaction.user.tag} (${userId}) has received ${linkHistoryCache[userId].history.length} total links (${linksUsed}/${maxLinks} in current period)`
        );
      } catch (err) {
        console.error("Failed to send DM:", err);
        await interaction.editReply({
          content:
            "❌ I couldn't send you a DM. Please check your dm / privacy settings and try again.",
        });
      }
    } catch (err) {
      console.error(err);

      if (interaction.deferred) {
        await interaction.editReply({
          content: `❌ Failed to send DM. Error: ${err}`,
        });
      } else {
        await interaction.reply({
          content: `❌ Failed to send DM. Error: ${err}`,
          ephemeral: true,
        });
      }
    }
  }
});

client.login(token);
