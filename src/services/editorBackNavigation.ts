export function installEditorBackHandler(
  target: Window,
  visualViewport = target.visualViewport,
): () => void {
  const sentinel = { essentialsStudioEditorBack: true };
  const viewportHeight = () => Math.min(
    target.innerHeight,
    visualViewport?.height ?? Number.POSITIVE_INFINITY,
  );
  const baselineHeight = viewportHeight();
  const keyboardThreshold = Math.max(80, baselineHeight * 0.15);
  const isKeyboardVisible = () => viewportHeight() < baselineHeight - keyboardThreshold;
  let keyboardWasVisible = isKeyboardVisible();
  let lastKeyboardDismissedAt = 0;
  const updateKeyboardState = () => {
    const keyboardVisible = isKeyboardVisible();
    if (keyboardWasVisible && !keyboardVisible) {
      lastKeyboardDismissedAt = Date.now();
    }
    keyboardWasVisible = keyboardVisible;
  };
  const handleBack = () => {
    target.history.pushState(sentinel, "", target.location.href);
    updateKeyboardState();
    const keyboardVisible = isKeyboardVisible();
    const keyboardJustDismissed = Date.now() - lastKeyboardDismissedAt < 1000;
    console.info("[editor-back] native back", { keyboardVisible, keyboardJustDismissed });
    if (keyboardVisible || keyboardJustDismissed) return;
    target.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }));
  };

  visualViewport?.addEventListener("resize", updateKeyboardState);
  target.addEventListener("resize", updateKeyboardState);
  target.history.pushState(sentinel, "", target.location.href);
  target.addEventListener("popstate", handleBack);
  return () => {
    target.removeEventListener("popstate", handleBack);
    target.removeEventListener("resize", updateKeyboardState);
    visualViewport?.removeEventListener("resize", updateKeyboardState);
  };
}
