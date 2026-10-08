import type { EmbedDefinition } from '../types';
import { calloutEmbed } from './callout';
import { echartsEmbed } from './echarts';
import { htmlEmbed } from './html';
import { mermaidEmbed } from './mermaid';
import { tableEmbed } from './table';

export const builtinEmbeds: EmbedDefinition[] = [
  htmlEmbed,
  calloutEmbed,
  tableEmbed,
  mermaidEmbed,
  echartsEmbed,
];

export { calloutEmbed, echartsEmbed, htmlEmbed, mermaidEmbed, tableEmbed };
