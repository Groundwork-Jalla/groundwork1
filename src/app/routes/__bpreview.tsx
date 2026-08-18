// TEMPORARY review harness — delete after checking the blueprints.
import { BLUEPRINTS } from '@/components/wizard/blueprints';

export default function BlueprintReview() {
  return (
    <div className="grid grid-cols-3 gap-3 bg-black p-3">
      {Object.entries(BLUEPRINTS).map(([key, node]) => (
        <div key={key} className="relative aspect-4/3 overflow-hidden rounded">
          {node}
          <p className="absolute bottom-1 left-2 z-20 font-mono text-[10px] text-white/70">{key}</p>
        </div>
      ))}
    </div>
  );
}
