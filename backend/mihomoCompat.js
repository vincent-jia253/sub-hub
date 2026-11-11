/**
 * mihomo 内核兼容层
 *
 * 背景（2026-11 踩过的坑）：
 * Xray 25.x 之后 REALITY 默认用 X25519MLKEM768（后量子混合密钥交换）做握手，
 * 而 mihomo 需要显式打开 `support-x25519mlkem768: true` 才会发这种密钥共享。
 * 没打开时内核日志只会打 `REALITY Authentication: false`，
 * 表现就是「节点参数全对、TCP 也通，但永远测不出延迟」。
 *
 * 所以凡是带 reality-opts 的节点，在生成 mihomo 配置时统一补上这个开关，
 * 老的 Xray REALITY 服务端（只支持纯 X25519）也不受影响：mihomo 拿不到
 * ML-KEM 协商时会自动退回纯 X25519。
 */

function isReality(node) {
  return !!(node && node['reality-opts'] && typeof node['reality-opts'] === 'object');
}

/**
 * 返回补齐了 mihomo 兼容开关的新节点对象（不改原对象）
 */
function applyMihomoCompat(node) {
  if (!isReality(node)) return node;
  const opts = node['reality-opts'];
  if (opts['support-x25519mlkem768'] === false) return node; // 显式关掉的尊重用户
  if (opts['support-x25519mlkem768'] === true) return node;
  return {
    ...node,
    'reality-opts': {
      ...opts,
      'support-x25519mlkem768': true
    }
  };
}

module.exports = { applyMihomoCompat, isReality };
