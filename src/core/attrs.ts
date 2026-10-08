export interface ParsedParams {
  attrs: Record<string, string>;
  positional: string[];
}

const ATTR_PATTERN = '([^\\s=]+)(?:=(?:"([^"]*)"|\'([^\']*)\'|([^\\s]+)))?';

/**
 * 解析嵌入体参数：
 *   `type=warning title="重点内容" zebra`
 *   -> attrs: { type, title }, positional: ['zebra']
 */
export function parseParams(input: string): ParsedParams {
  const attrs: Record<string, string> = {};
  const positional: string[] = [];
  if (!input) return { attrs, positional };

  const re = new RegExp(ATTR_PATTERN, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(input))) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4];
    if (value === undefined) positional.push(key);
    else attrs[key] = value;
  }
  return { attrs, positional };
}