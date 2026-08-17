import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: ["supabase/.branches/**", "supabase/.temp/**"],
  },
];

export default eslintConfig;
