import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import AnalyticsPage from "../components/AnalyticsPage";
import type { CareLog } from "../data/careLogBatching";

afterEach(() => cleanup());

describe("Analytics page", () => {
  it("summarizes care and shows the leading family member for each care type", () => {
    const now = new Date().toISOString();
    const logs: CareLog[] = [
      { id: "treat-1", catId: "cat-1", metric: "treats", actorUserId: "person-1", who: "Alex", what: "Dental treats", detail: "Added 3 treats", amountDelta: 3, timestamp: now },
      { id: "treat-2", catId: "cat-1", metric: "treats", actorUserId: "person-2", who: "Sam", what: "Dental treats", detail: "Added 1 treat", amountDelta: 1, timestamp: now },
      { id: "play-1", catId: "cat-1", metric: "played", actorUserId: "person-2", who: "Sam", what: "Playtime", detail: "Added 2 sessions", amountDelta: 2, timestamp: now },
    ];
    const { container } = render(<AnalyticsPage
      cats={[{ id: "cat-1", name: "Mochi", color: "#abc", initial: "M" }]}
      logs={logs}
      goals={{ "cat-1": { treatsGoal: 4, kibbleGoal: 3, cansGoal: 1 } }}
      selectedCatId="cat-1"
      timezone="UTC"
    />);

    expect(screen.getByRole("heading", { name: "Analytics" })).not.toBeNull();
    const treatRow = container.querySelectorAll(".analytics-contribution-row")[0];
    expect(within(treatRow as HTMLElement).getByText("Alex")).not.toBeNull();
    expect(treatRow.textContent).toContain("3 treats");
  });

  it("ranks the top three by share of care check-ins and filters the breakdown when selected", async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    render(<AnalyticsPage
      cats={[{ id: "cat-1", name: "Mochi", color: "#abc", initial: "M" }]}
      logs={[
        { id: "alex-treat-1", catId: "cat-1", metric: "treats", actorUserId: "alex-id", who: "Alex", what: "Dental treats", detail: "Added 1 treat", amountDelta: 1, timestamp: now },
        { id: "alex-treat-2", catId: "cat-1", metric: "treats", actorUserId: "alex-id", who: "Alex", what: "Dental treats", detail: "Added 1 treat", amountDelta: 1, timestamp: now },
        { id: "alex-kibble", catId: "cat-1", metric: "kibble", actorUserId: "alex-id", who: "Alex", what: "Kibble", detail: "Added 3 spoons", amountDelta: 3, timestamp: now },
        { id: "sam-play", catId: "cat-1", metric: "played", actorUserId: "sam-id", who: "Sam", what: "Playtime", detail: "Added 5 sessions", amountDelta: 5, timestamp: now },
        { id: "sam-water", catId: "cat-1", metric: "fountain", actorUserId: "sam-id", who: "Sam", what: "Water top-up", detail: "Added 1 time", amountDelta: 1, timestamp: now },
        { id: "mina-poop", catId: "cat-1", metric: "pooped", actorUserId: "mina-id", who: "Mina", what: "Pooped", detail: "Added 1 time", amountDelta: 1, timestamp: now },
      ]}
      goals={{ "cat-1": { treatsGoal: 4, kibbleGoal: 3, cansGoal: 1 } }}
      members={[
        { user_id: "alex-id", display_name: "Alex", avatar_url: "https://example.com/alex.jpg" },
        { user_id: "sam-id", display_name: "Sam", avatar_url: null },
        { user_id: "mina-id", display_name: "Mina", avatar_url: null },
      ]}
      selectedCatId="cat-1"
      timezone="UTC"
    />);

    const first = screen.getByRole("button", { name: /Show contributions for Alex, rank 1, 50%/ });
    expect(first.querySelector("img")?.getAttribute("src")).toBe("https://example.com/alex.jpg");
    expect(screen.getByRole("button", { name: /Show contributions for Sam, rank 2, 33%/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Show contributions for Mina, rank 3, 17%/ })).not.toBeNull();

    await user.click(first);
    expect(screen.getByText("Care breakdown for Alex")).not.toBeNull();
    const contributionTable = document.querySelector(".analytics-contribution-list") as HTMLElement;
    expect(within(contributionTable).getByText("Dental treats")).not.toBeNull();
    expect(within(contributionTable).getByText("Kibble")).not.toBeNull();
    expect(within(contributionTable).queryByText("Playtime")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show everyone" }));
    expect(screen.getByText("Share of logged care check-ins")).not.toBeNull();
  });

  it("can compare all cats and switch the reporting range", async () => {
    const user = userEvent.setup();
    render(<AnalyticsPage cats={[{ id: "cat-1", name: "Mochi", color: "#abc", initial: "M" }]} logs={[]} goals={{}} selectedCatId="cat-1" timezone="UTC" />);
    await user.click(screen.getByRole("button", { name: "All cats" }));
    expect(screen.getByRole("button", { name: "All cats" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Per month" }));
    expect(screen.getByRole("button", { name: "Per month" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("selects cats by portrait and switches cats with a horizontal swipe", async () => {
    const user = userEvent.setup();
    render(<AnalyticsPage cats={[
      { id: "cat-1", name: "Mochi", color: "#abc", initial: "M" },
      { id: "cat-2", name: "Tofu", color: "#def", initial: "T" },
    ]} logs={[]} goals={{}} selectedCatId="cat-1" timezone="UTC" />);
    const picker = screen.getByLabelText("Choose a cat. Swipe to switch cats.");
    await user.click(screen.getByRole("button", { name: "Show analytics for Tofu" }));
    expect(screen.getByText(/logged · Tofu/)).not.toBeNull();

    fireEvent.pointerDown(picker, { pointerType: "touch", clientX: 120, clientY: 40 });
    fireEvent.pointerUp(picker, { pointerType: "touch", clientX: 50, clientY: 42 });
    expect(screen.getByRole("button", { name: "Show analytics for Mochi" }).getAttribute("aria-pressed")).toBe("true");
  });
});
