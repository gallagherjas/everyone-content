// Preserve platform IDs beyond JavaScript's safe integer range before any normalization.
// Node的JSON.parse向reviver传第三个context参数（含原始文本），是v8扩展，故整体as any。
export function parseJson(text: string) {
  return JSON.parse(text, ((key: string, value: any, context: any) => {
    if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
      if (!context?.source) throw new Error('unsafe_integer');
      return context.source;
    }
    return value;
  }) as any);
}
