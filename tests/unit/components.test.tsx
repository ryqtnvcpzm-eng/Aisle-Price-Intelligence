import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Checkbox } from "@/components/ui/checkbox";
import { Delta } from "@/components/ui/price";
import { Segmented } from "@/components/ui/segmented";
import { Freshness } from "@/components/ui/status";
import { TooltipProvider } from "@/components/ui/tooltip";

describe("Delta", () => {
  it("never relies on color alone", () => {
    render(<Delta ratio={-0.082} />);
    expect(screen.getByText("8.2%")).toBeInTheDocument();
    expect(screen.getByText("decrease")).toHaveClass("sr-only");
  });
  it("shows a dash with an explanation when the window has no data", () => {
    render(<Delta ratio={null} />);
    expect(screen.getByTitle(/Not enough observations/)).toHaveTextContent("—");
  });
});

describe("Segmented", () => {
  function Harness({ onChange }: { onChange: (v: string) => void }) {
    const [v, setV] = useState("a");
    return <Segmented ariaLabel="Range" value={v} onChange={(x) => { setV(x); onChange(x); }} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }]} />;
  }
  it("is a radiogroup with arrow-key navigation", async () => {
    const spy = vi.fn();
    render(<Harness onChange={spy} />);
    expect(screen.getByRole("radiogroup", { name: "Range" })).toBeInTheDocument();
    const a = screen.getByRole("radio", { name: "A" });
    expect(a).toHaveAttribute("aria-checked", "true");
    a.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(spy).toHaveBeenLastCalledWith("b");
    await userEvent.keyboard("{ArrowLeft}");
    expect(spy).toHaveBeenLastCalledWith("a");
    await userEvent.click(screen.getByRole("radio", { name: "C" }));
    expect(screen.getByRole("radio", { name: "C" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("Checkbox", () => {
  it("toggles and exposes its label", async () => {
    const spy = vi.fn();
    render(<Checkbox checked={false} onCheckedChange={spy} label="Select 1 kg" />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select 1 kg" }));
    expect(spy).toHaveBeenCalledWith(true);
  });
});

describe("Freshness", () => {
  it("labels state in words, not just a dot", () => {
    render(
      <TooltipProvider>
        <Freshness state="provider_stale" lastSuccessAt={new Date().toISOString()} />
      </TooltipProvider>,
    );
    expect(screen.getByText("Provider data is older")).toBeInTheDocument();
  });
});
