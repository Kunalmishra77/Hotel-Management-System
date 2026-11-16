// See as-user-hook.cjs — cache revalidation means nothing outside a Next request.
module.exports = { revalidatePath() {}, revalidateTag() {}, unstable_cache: (fn) => fn, unstable_noStore() {} };
