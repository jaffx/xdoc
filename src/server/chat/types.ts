/** 对话模块的领域类型：dao 存它、service 裁它、manager 把它喂给模型 */

/** 一条对话记录（仅存最终文本，不存思考过程与工具调用） */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  /** 写入时间戳（ms） */
  at: number;
  /** 该回答是否被用户中断 */
  stopped?: boolean;
}

/** 送给模型的消息形态 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
