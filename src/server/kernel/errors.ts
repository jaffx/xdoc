/**
 * 领域无关的错误词汇。
 *
 * 这里**不许**出现任何协议概念——没有状态码、没有 JSON-RPC code。存储层与业务层
 * 只说「出了哪类问题」，翻译成协议码是入口层的事，那张映射表在 kernel/http.ts。
 * 这样存储层不依赖 HTTP，同一个 Dao 换到 MCP、CLI 或别的入口上都不用改。
 */

/** 所有领域错误的基类。分层时按它筛，不必逐个 instanceof */
export abstract class DomainError extends Error {}

/** 要读的东西不存在 */
export class NotFoundError extends DomainError {}

/** 要写的位置已被占用 */
export class ConflictError extends DomainError {}

/** 路径本身不合法：空、含非法字符、过长、以 . 开头 */
export class InvalidPathError extends DomainError {}

/** 路径合法，但越出了允许的根目录 */
export class PathEscapeError extends DomainError {}

/** 输入不满足操作要求：缺字段、格式不对、规则不允许这么改 */
export class InvalidInputError extends DomainError {}
