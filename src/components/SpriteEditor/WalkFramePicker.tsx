import { useEffect, useRef } from "react";
import { getWalkSpriteFrame, WALK_FRAME_COUNT, WALK_FRAME_DIRECTIONS } from "../../services/spriteSheetFrames";

interface Props {
  source: HTMLCanvasElement;
  revision: number;
  selected: number;
  onChoose: (index: number) => void;
  onClose: () => void;
}

export function WalkFramePicker({ source, revision, selected, onChoose, onClose }: Props) {
  const previews = useRef<(HTMLCanvasElement | null)[]>([]);
  const selectedButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedButton.current?.focus();
  }, []);

  useEffect(() => {
    for (let index = 0; index < WALK_FRAME_COUNT; index++) {
      const frame = getWalkSpriteFrame(source.width, source.height, index);
      const canvas = previews.current[index];
      if (!canvas || !frame) continue;
      // Bounded thumbnail buffers even for exceptionally large RMXP sheets.
      const scale = Math.min(1, 64 / Math.max(frame.width, frame.height));
      canvas.width = Math.max(1, Math.round(frame.width * scale));
      canvas.height = Math.max(1, Math.round(frame.height * scale));
      const context = canvas.getContext("2d");
      if (!context) continue;
      context.imageSmoothingEnabled = false;
      context.drawImage(source, frame.x, frame.y, frame.width, frame.height,
        0, 0, canvas.width, canvas.height);
    }
  }, [source, revision]);

  return (
    <section className="sprite-frame-picker" role="region" aria-label="Walking frame picker"
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}>
      <header><strong>Choose a walking frame</strong><button type="button"
        onClick={onClose} aria-label="Close walking frame picker">Close</button></header>
      <div className="sprite-frame-picker-grid">
        {Array.from({ length: WALK_FRAME_COUNT }, (_, index) => (
          <button key={index} type="button" aria-label={`Choose ${WALK_FRAME_DIRECTIONS[Math.floor(index / 4)]} frame ${index % 4 + 1} of 4`}
            aria-pressed={selected === index}
            ref={selected === index ? selectedButton : undefined}
            onClick={() => onChoose(index)}>
            <canvas ref={element => { previews.current[index] = element; }} aria-hidden="true" />
            <span>{WALK_FRAME_DIRECTIONS[Math.floor(index / 4)]} {index % 4 + 1}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
