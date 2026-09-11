// Supabase の公開設定。値を入れるとログイン機能が有効になる。
// 空のままなら /api/config（Vercel の環境変数 SUPABASE_URL / SUPABASE_ANON_KEY）を参照し、
// それも無ければ端末内保存のみで動作する。anon key は公開前提のキー（RLS で保護）。
window.FXLOT_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
