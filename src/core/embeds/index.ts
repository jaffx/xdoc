import type { EmbedDefinition } from '../types';
import { calloutEmbed } from './callout';
import { htmlEmbed } from './html';
import { tableEmbed } from './table';
import { todoEmbed } from './todo';

export const builtinEmbeds: EmbedDefinition[] = [htmlEmbed, calloutEmbed, todoEmbed, tableEmbed];

export { calloutEmbed, htmlEmbed, tableEmbed, todoEmbed };