import { REST, Routes } from 'discord.js';
import { commandData } from './commands.js';
export async function registerCommands(token: string, clientId: string, guildId?: string) {
  const rest = new REST({ version: '10', timeout: 15000 }).setToken(token);
  const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);
  await rest.put(route, { body: commandData });
}
