import fetch from 'node-fetch';
import chalk from 'chalk';

interface JsonBinResponse {
  record: Record<string, any>;
}

const BIN_ID = process.env.JSONBIN_ID!;
const API_KEY = process.env.JSONBIN_API_KEY!;
const BASE_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

let linkHistoryCache: Record<string, any> = {};

export async function loadLinkHistoryFromJsonBin(): Promise<Record<string, any>> {
  try {
    const res = await fetch(BASE_URL, {
      headers: { 'X-Master-Key': API_KEY }
    });
    if (!res.ok) {
      console.error(`❌ Failed to load link history: ${res.status} ${res.statusText}`);
      return {};
    }
    const body = (await res.json()) as JsonBinResponse;
    linkHistoryCache = body.record ?? {};
    console.log(chalk.green('✅ Link history loaded from JSONBin'));
    return linkHistoryCache;
  } catch (err) {
    console.error(chalk.red('❌ Error loading link history:'), err);
    return {};
  }
}

export async function saveLinkHistoryToJsonBin(
  linkHistory: Record<string, any>
): Promise<boolean> {
  try {
    const res = await fetch(BASE_URL, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': API_KEY
      },
      body: JSON.stringify(linkHistory, null, 2)
    });
    if (res.ok) {
      console.log(chalk.green('✅ Link history saved to JSONBin'));
      return true;
    } else {
      console.error(
        chalk.red(`❌ Failed to save link history: ${res.status} ${res.statusText}`)
      );
      return false;
    }
  } catch (err) {
    console.error(chalk.red('❌ Error saving link history:'), err);
    return false;
  }
}
