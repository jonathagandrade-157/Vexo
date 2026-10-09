import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: ["deliverables/**", "supabase/.branches/**", "supabase/.temp/**"],
  },
];

export default eslintConfig;
