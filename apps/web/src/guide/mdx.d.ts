declare module "*.mdx" {
  import type { ComponentType } from "react";
  const Page: ComponentType<{ components?: Record<string, ComponentType<never>> }>;
  export default Page;
}
