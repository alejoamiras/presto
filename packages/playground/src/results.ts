import type { StepTiming } from "./aztec";
import type { AnimationPhase } from "./phase-queue";
import { $, formatDuration } from "./ui";

export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/** Shorten "ContractName:function_name" → "function_name" */
export function shortFnName(name: string): string {
  if (!name) return "unknown";
  const i = name.lastIndexOf(":");
  return i >= 0 && i < name.length - 1 ? name.slice(i + 1) : name;
}

/** Build a "label ··· value" row using safe DOM APIs (no innerHTML). */
export function buildDotRow(
  className: string,
  label: string,
  labelClass: string,
  value: string,
  valueClass: string,
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = className;

  const labelSpan = document.createElement("span");
  labelSpan.className = labelClass;
  labelSpan.textContent = label;

  const dots = document.createElement("span");
  dots.className = "step-dots";

  const valueSpan = document.createElement("span");
  valueSpan.className = valueClass;
  valueSpan.textContent = value;

  row.append(labelSpan, dots, valueSpan);
  return row;
}

function appendSimulationRows(
  container: HTMLElement,
  simulation: NonNullable<StepTiming["simulation"]>,
) {
  container.appendChild(
    buildDotRow(
      "step-sim-row",
      "sim",
      "text-brand-text-muted",
      formatMs(simulation.totalMs),
      "tabular-nums",
    ),
  );
  container.appendChild(
    buildDotRow(
      "step-sim-row",
      "sync",
      "text-brand-text-muted",
      formatMs(simulation.syncMs),
      "tabular-nums",
    ),
  );
  for (const fn of simulation.perFunction) {
    container.appendChild(
      buildDotRow(
        "step-sim-row",
        shortFnName(fn.name),
        "text-brand-text-muted",
        formatMs(fn.ms),
        "tabular-nums",
      ),
    );
  }
}

function appendTimingRow(container: HTMLElement, label: string, durationMs: number | undefined) {
  if (durationMs == null) return;
  container.appendChild(
    buildDotRow(
      "step-sim-row",
      label,
      "text-brand-text-muted",
      formatMs(durationMs),
      "tabular-nums",
    ),
  );
}

function buildStepGroup(step: StepTiming): HTMLDivElement {
  const group = document.createElement("div");
  group.appendChild(
    buildDotRow(
      "step-row",
      step.step,
      "text-brand-text",
      formatMs(step.durationMs),
      "text-brand-accent/80 tabular-nums",
    ),
  );

  if (!step.simulation && step.proveSendMs == null) return group;
  const details = document.createElement("div");
  details.className = "step-sim";
  if (step.simulation) appendSimulationRows(details, step.simulation);
  appendTimingRow(details, "prove", step.proveMs);
  appendTimingRow(details, "prove + send", step.proveSendMs);
  appendTimingRow(details, "confirm", step.confirmMs);
  group.appendChild(details);
  return group;
}

export function renderSteps(container: HTMLElement, steps: StepTiming[]): void {
  container.replaceChildren();
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = `${steps.length} steps`;
  details.appendChild(summary);

  const list = document.createElement("div");
  list.className = "mt-1.5 space-y-1.5";

  for (const step of steps) {
    list.appendChild(buildStepGroup(step));
  }

  details.appendChild(list);
  container.appendChild(details);
  container.classList.remove("hidden");
}

/**
 * Display a result in the appropriate column.
 * @param prefix - Element ID prefix: "" for embedded (uses `time-local` etc.), "ext-" for external (uses `ext-time-wallet` etc.)
 * @param mode - The mode suffix for element IDs (e.g., "local", "uee", "tee", "wallet")
 */
export function showResult(
  prefix: string,
  mode: string,
  durationMs: number,
  tag: string | undefined,
  steps?: StepTiming[],
): void {
  $(`${prefix}results`).classList.remove("hidden");

  const timeEl = $(`${prefix}time-${mode}`);
  timeEl.textContent = formatDuration(durationMs);
  timeEl.className = "text-3xl font-bold tabular-nums text-brand-accent font-mono";

  const tagEl = $(`${prefix}tag-${mode}`);
  tagEl.textContent = tag ?? "";
  tagEl.className = `mt-1.5 text-[10px] uppercase tracking-widest ${
    tag === "token flow"
      ? "text-brand-accent/70"
      : tag === "cold"
        ? "text-brand-warning/70"
        : tag === "differs from fixture"
          ? "text-brand-danger/70"
          : "text-brand-accent/70"
  }`;

  $(`${prefix}result-${mode}`).classList.add("result-filled");

  if (steps?.length) {
    renderSteps($(`${prefix}steps-${mode}`), steps);
  }
}

/** Map onStep step names to app-level animation phases. */
export function stepToPhase(stepName: string): AnimationPhase | null {
  if (stepName.includes("simulat")) return "app:simulate";
  if (stepName.includes("proving") || stepName.includes("deploying")) return "app:prove";
  if (stepName.includes("confirm")) return "app:confirm";
  return null;
}
