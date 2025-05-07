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

let linkHistoryCache: any = {};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel, Partials.Message, Partials.User],
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
      linkHistoryCache = JSON.parse(data);
      console.log("✅ Link history loaded from Dropbox");
    } else if (response.status === 409) {
      linkHistoryCache = {};
      console.log("🔍 No existing link history found, starting fresh");
    } else {
      console.error(
        `❌ Failed to load link history: ${response.status} ${response.statusText}`
      );
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

async function getRandomUniqueLink(userId: string): Promise<string | null> {
  const links = readFileSync("./links.txt", "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (!linkHistoryCache[userId]) {
    linkHistoryCache[userId] = [];
  }

  const availableLinks = links.filter(
    (link) => !linkHistoryCache[userId].includes(link)
  );

  if (availableLinks.length === 0) {
    return null;
  }

  const randomLink =
    availableLinks[Math.floor(Math.random() * availableLinks.length)];

  linkHistoryCache[userId].push(randomLink);

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
      .setDescription("Click the button below to receive a link in your DMs.")
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
      const randomLink = await getRandomUniqueLink(userId);
      const getLunaarEmoji = client.emojis.cache.get("1369509638956908674");
      const lunaarEmoji = getLunaarEmoji?.toString();

      if (!randomLink) {
        await interaction.editReply({
          content:
            "❌ You have already received all available links. Please check back later.",
        });
        return;
      }

      try {
        await interaction.user.send(
          `${lunaarEmoji} Here's your [Lunaar link](${randomLink}) ${lunaarEmoji}`
        );

        await interaction.editReply({
          content: "✅ Check your DMs",
        });

        console.log(
          `User ${interaction.user.tag} (${userId}) has received ${linkHistoryCache[userId].length} unique links`
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
