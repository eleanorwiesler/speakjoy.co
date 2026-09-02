/* speakjoy — accounts and sync.
 *
 * Loaded before the journal. Everything here is optional: with no project
 * configured the app runs exactly as it did, on this device alone. That
 * matters — signing in should be something you choose, not a gate in front of
 * a journal you have already written in.
 */

/* Paste your project's URL and anon key here. The anon key is meant to be
   public; what protects a journal is the row-level security in schema.sql,
   not the secrecy of this string. */
window.SPEAKJOY_SUPABASE = {
  url: '',
  anonKey: '',
};

(() => {
  const cfg = window.SPEAKJOY_SUPABASE;
  const configured = !!(cfg.url && cfg.anonKey);

  /** What the journal talks to. Every method is safe to call unconfigured. */
  const Sync = window.Sync = {
    configured,
    client: null,
    user: null,

  /** True once somebody is signed in. The microphone waits on this. */
  get signedIn() { return Boolean(this.user); },

  /**
   * The bearer token for the proxy, or null.
   *
   * Read fresh each time rather than kept: Supabase refreshes it in the
   * background, and a token cached at sign-in is a token that expires in the
   * middle of somebody's sentence.
   */
  async token() {
    if (!this.client) return null;
    const { data } = await this.client.auth.getSession();
    return data.session?.access_token ?? null;
  },
    ready: false,
    onChange: () => {},

    async start(){
      if (!configured) { this.ready = true; this.onChange(); return; }
      const { createClient } = await import(
        'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      this.client = createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      const { data } = await this.client.auth.getSession();
      this.user = data.session?.user ?? null;
      this.client.auth.onAuthStateChange((_e, session) => {
        const was = this.user?.id;
        this.user = session?.user ?? null;
        this.ready = true;
        if (was !== this.user?.id) this.onChange();
      });
      this.ready = true;
      this.onChange();
    },

    /* ---- ways in ---- */

    async signUpWithEmail(email, password){
      const { error } = await this.client.auth.signUp({ email, password });
      if (error) throw error;
      // A project with confirmations on returns no session until the link is
      // followed, so the caller is told which of the two happened.
      const { data } = await this.client.auth.getSession();
      return data.session ? 'in' : 'check-your-email';
    },
    async signInWithEmail(email, password){
      const { error } = await this.client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return 'in';
    },
    async signInWith(provider){
      const { error } = await this.client.auth.signInWithOAuth({
        provider,                                   // 'google' | 'apple'
        options: { redirectTo: location.href.split('#')[0] },
      });
      if (error) throw error;
    },
    async signOut(){ await this.client?.auth.signOut(); },

    /* ---- the journals themselves ----
       A journal is written and read whole, and the newer of the two copies
       wins. That is enough for one person on two devices, and it is worth
       being plain that it is not enough for two people at once: the later
       save takes the whole journal, not the difference. */

    async pull(){
      if (!this.user) return null;
      const { data: rows, error } = await this.client
        .from('journals').select('*').is('deleted_at', null)
        .order('updated_at', { ascending: true });
      if (error) throw error;
      const { data: profile } = await this.client
        .from('profiles').select('*').eq('id', this.user.id).maybeSingle();
      return { journals: rows ?? [], profile: profile ?? null };
    },

    async pushJournal(j){
      if (!this.user) return;
      const { error } = await this.client.from('journals').upsert({
        id: j.uuid || undefined,
        owner: this.user.id,
        title: j.title, year: j.year,
        cloth: { cov: j.cov, label: j.label },
        ink: { rgb: j.ink },
        ruling: j.ruling ?? null,
        blocks: j.content ?? [],
        favourite: !!j.favourite,
      }, { onConflict: 'id' });
      if (error) throw error;
    },

    async removeJournal(uuid){
      if (!this.user || !uuid) return;
      await this.client.from('journals')
        .update({ deleted_at: new Date().toISOString() }).eq('id', uuid);
    },

    async pushProfile(name, settings){
      if (!this.user) return;
      await this.client.from('profiles')
        .upsert({ id: this.user.id, name, settings }, { onConflict: 'id' });
    },
  };
})();
