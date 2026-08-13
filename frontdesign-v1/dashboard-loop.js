function motionReduced() {
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function cloneTrackChildren(track) {
  const clones = [...track.children].map((child) => {
    const clone = child.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    clone.querySelectorAll('a, button, input, select, textarea, [tabindex]').forEach((item) => item.setAttribute('tabindex', '-1'));
    return clone;
  });
  clones.forEach((clone) => track.append(clone));
}

export function createSeamlessLoop({
  viewport,
  track,
  pauseButton = null,
  signature = '',
  speedPxPerSecond = 10,
  itemCount = 0,
  active = () => true,
  blocked = () => false,
} = {}) {
  if (!viewport || !track) return null;
  const existing = viewport.__blacksoilLoop;
  if (existing?.signature === signature) {
    existing.refresh();
    return existing;
  }
  existing?.destroy();
  const sourceHeight = track.scrollHeight;
  const rowGap = Number.parseFloat(globalThis.getComputedStyle?.(track).rowGap || '0') || 0;
  const loopDistance = sourceHeight + rowGap;
  const canLoop = itemCount > 1 && sourceHeight > viewport.clientHeight + 1;
  const reducedMotion = motionReduced();
  const userPaused = { value: pauseButton?.dataset.manualPaused === 'true' || reducedMotion };
  let hoverPaused = false;
  let focusPaused = false;
  let animation = null;
  const prepareAnimation = () => {
    if (!canLoop || animation) return;
    cloneTrackChildren(track);
    const duration = loopDistance / Math.max(1, speedPxPerSecond);
    track.style.setProperty('--dv2-loop-distance', `${loopDistance}px`);
    track.style.setProperty('--dv2-loop-duration', `${duration}s`);
    animation = track.animate(
      [{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(0,-${loopDistance}px,0)` }],
      { duration: duration * 1000, easing: 'linear', iterations: Infinity },
    );
  };
  if (canLoop && !reducedMotion) prepareAnimation();
  const updateButton = () => {
    if (!pauseButton) return;
    pauseButton.hidden = !canLoop;
    pauseButton.dataset.manualPaused = String(userPaused.value);
    pauseButton.setAttribute('aria-pressed', String(userPaused.value));
    pauseButton.setAttribute('aria-label', userPaused.value ? '继续自动循环' : '暂停自动循环');
    pauseButton.textContent = userPaused.value ? '播放' : '暂停';
  };
  const refresh = () => {
    if (!animation) return updateButton();
    const shouldPause = userPaused.value || hoverPaused || focusPaused || !active() || blocked();
    if (shouldPause) animation.pause();
    else animation.play();
    updateButton();
  };
  const onEnter = () => { hoverPaused = true; refresh(); };
  const onLeave = () => { hoverPaused = false; refresh(); };
  const onFocusIn = () => { focusPaused = true; refresh(); };
  const onFocusOut = () => { focusPaused = viewport.contains(document.activeElement); refresh(); };
  const onButton = () => {
    userPaused.value = !userPaused.value;
    if (!userPaused.value) prepareAnimation();
    refresh();
  };
  viewport.addEventListener('mouseenter', onEnter);
  viewport.addEventListener('mouseleave', onLeave);
  viewport.addEventListener('focusin', onFocusIn);
  viewport.addEventListener('focusout', onFocusOut);
  pauseButton?.addEventListener('click', onButton);
  const controller = {
    signature,
    refresh,
    destroy() {
      animation?.cancel();
      viewport.removeEventListener('mouseenter', onEnter);
      viewport.removeEventListener('mouseleave', onLeave);
      viewport.removeEventListener('focusin', onFocusIn);
      viewport.removeEventListener('focusout', onFocusOut);
      pauseButton?.removeEventListener('click', onButton);
      if (viewport.__blacksoilLoop === controller) delete viewport.__blacksoilLoop;
    },
  };
  viewport.__blacksoilLoop = controller;
  refresh();
  return controller;
}
