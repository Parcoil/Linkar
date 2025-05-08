import dotenv from "dotenv";

dotenv.config();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const dropboxToken = process.env.DROPBOX_TOKEN;

export { token, clientId, guildId, dropboxToken };
