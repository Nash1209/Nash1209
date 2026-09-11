// GET /api/config — 公開設定をクライアントに渡す（Supabase の URL と anon key は公開前提のキー）
// Vercel の環境変数 SUPABASE_URL / SUPABASE_ANON_KEY を設定すると、ログイン機能が有効になる。
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  });
}
