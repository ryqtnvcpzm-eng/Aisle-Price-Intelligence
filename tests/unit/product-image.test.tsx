import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductImage } from "@/components/ui/product-image";

/** jsdom never fetches images; control `complete` and `decode()` per test. */
function stubImage({ complete, decodes }: { complete: boolean; decodes?: boolean }) {
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(complete);
  HTMLImageElement.prototype.decode = vi.fn(() => (decodes ? Promise.resolve() : Promise.reject(new Error("broken"))));
}
const status = (c: HTMLElement) => c.querySelector("[data-image-status]")!.getAttribute("data-image-status");
const img = (c: HTMLElement) => c.querySelector("img");

afterEach(() => vi.restoreAllMocks());

describe("ProductImage loading states", () => {
  it("fades in after a normal load", () => {
    stubImage({ complete: false });
    const { container } = render(<ProductImage src="/a.png" alt="A" />);
    expect(status(container)).toBe("loading");
    expect(img(container)).toHaveClass("opacity-0");
    fireEvent.load(img(container)!);
    expect(status(container)).toBe("loaded");
    expect(img(container)).toHaveClass("opacity-100");
  });

  it("settles images that completed before React attached onLoad (cache hits)", async () => {
    stubImage({ complete: true, decodes: true });
    const { container } = render(<ProductImage src="/cached.svg" alt="Cached" />);
    await act(async () => {});
    expect(status(container)).toBe("loaded");
    expect(HTMLImageElement.prototype.decode).toHaveBeenCalled();
  });

  it("shows the placeholder for images that were already broken", async () => {
    stubImage({ complete: true, decodes: false });
    const { container, getByRole } = render(<ProductImage src="/missing.png" alt="Missing" />);
    await act(async () => {});
    expect(status(container)).toBe("error");
    expect(img(container)).toBeNull();
    expect(getByRole("img", { name: "Missing" })).toBeInTheDocument();
  });

  it("shows the placeholder when loading fails", () => {
    stubImage({ complete: false });
    const { container } = render(<ProductImage src="/x.png" alt="X" />);
    fireEvent.error(img(container)!);
    expect(status(container)).toBe("error");
  });

  it("resets and retries when the source changes, even after a failure", () => {
    stubImage({ complete: false });
    const { container, rerender } = render(<ProductImage src="/bad.png" alt="P" />);
    fireEvent.error(img(container)!);
    expect(img(container)).toBeNull();
    rerender(<ProductImage src="/good.png" alt="P" />);
    expect(status(container)).toBe("loading");
    expect(img(container)).toHaveAttribute("src", "/good.png");
    fireEvent.load(img(container)!);
    expect(status(container)).toBe("loaded");
  });

  it("ignores late callbacks from a previous source", async () => {
    stubImage({ complete: false });
    const { container, rerender } = render(<ProductImage src="/one.png" alt="P" />);
    const first = img(container)!;
    rerender(<ProductImage src="/two.png" alt="P" />);
    expect(img(container)).not.toBe(first); // keyed by src: a fresh element
    fireEvent.load(first); // detached element — must not mark /two.png loaded
    expect(status(container)).toBe("loading");
  });

  it("renders a labelled placeholder when there is no image", () => {
    const { container, getByRole } = render(<ProductImage src={null} alt="No image" />);
    expect(status(container)).toBe("none");
    expect(getByRole("img", { name: "No image" })).toBeInTheDocument();
  });
});
