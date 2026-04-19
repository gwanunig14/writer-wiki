declare global {
  namespace App {
    interface Locals {
      projectState: import("$lib/types/domain").ProjectState;
    }

    interface PageData {
      projectState: import("$lib/types/domain").ProjectState;
    }
  }
}

export {};
