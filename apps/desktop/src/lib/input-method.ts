/** Safari can report the confirmation key after isComposing has turned false. */
export const isInputComposition = (event: { isComposing?: boolean; keyCode?: number }) => Boolean(event.isComposing || event.keyCode === 229);
