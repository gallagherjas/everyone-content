// Preserve platform IDs beyond JavaScript's safe integer range before any normalization.
export function parseJson(text) {
  return JSON.parse(text,(key,value,context)=>{
    if(typeof value==='number'&&Number.isInteger(value)&&!Number.isSafeInteger(value)) {
      if(!context?.source)throw new Error('unsafe_integer');
      return context.source;
    }
    return value;
  });
}
