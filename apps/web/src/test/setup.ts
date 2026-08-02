import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library auto-cleans only when Vitest runs with `globals: true`,
// which this project does not. Without this, every render stays in the
// document and later queries match elements left behind by earlier tests —
// failing as "multiple elements found" in whichever test happens to run last.
afterEach(cleanup);
