import { supabase } from "./supabase";

export type CareAnimation = "playful" | "subtle" | "none" | "chomp" | "play" | "outside" | "water" | "pee" | "poop" | "paw" | "ears";
export type CareActionConfig = { key: string; name: string; shortName: string; icon: string; unit: string; behavior: "numeric" | "percentage" | "toggle"; targetCadence: "none" | "daily" | "weekly" | "monthly"; targetAmount: number | null; animation: CareAnimation; color: string; deleted?: boolean };
export type Family = { id: string; name: string; timezone: string; care_actions?: CareActionConfig[] };
export type FamilyMember = { id: string; family_id: string; user_id: string | null; email: string; display_name: string; added_at: string; avatar_url?: string | null };
export type CloudCat = { id: string; family_id: string; name: string; color: string; photo_path: string | null; archived_at: string | null };
export type TargetRule = { id: string; family_id: string; cat_id: string; metric: string; cadence: "daily" | "weekly" | "monthly"; target_amount: number; unit: string; effective_from: string; effective_until: string | null };
export type CareEvent = { id: string; family_id: string; cat_id: string; actor_user_id: string; metric: string; amount_delta: number; unit: string; detail: string; occurred_at: string; reverses_event_id?: string | null; action_name_snapshot?: string | null; action_icon_snapshot?: string | null; action_unit_snapshot?: string | null };

function getClient() {
  if (!supabase) throw new Error("Supabase is not configured. Add the project URL and publishable key to .env.local.");
  return supabase;
}

export async function createFamily(name: string, timezone: string) {
  const { data, error } = await getClient().rpc("create_family", { p_name: name, p_timezone: timezone });
  if (error) throw error;
  return data as Family;
}

export async function getMyFamily(userId: string): Promise<Family | null> {
  const { data, error } = await getClient()
    .from("family_members")
    .select("family:families(id,name,timezone,care_actions)")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const family = data?.family;
  return (Array.isArray(family) ? family[0] : family) as Family | null;
}

export async function updateFamily(familyId: string, changes: Pick<Family, "name">) {
  const { error } = await getClient().from("families").update(changes).eq("id", familyId);
  if (error) throw error;
}

export async function saveFamilyCareActions(familyId: string, actions: CareActionConfig[]) {
  const { error } = await getClient().from("families").update({ care_actions: actions }).eq("id", familyId);
  if (error) throw error;
}

async function listStorageEntries(path: string) {
  const bucket = getClient().storage.from("cat-photos");
  const entries: Array<{ name: string }> = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await bucket.list(path, { limit: pageSize, offset });
    if (error) throw error;
    const page = data ?? [];
    entries.push(...page);
    if (page.length < pageSize) return entries;
  }
}

export async function deleteFamily(familyId: string) {
  const client = getClient();
  const { error: accessError } = await client.rpc("assert_family_delete_allowed", { p_family_id: familyId });
  if (accessError) throw accessError;

  const bucket = client.storage.from("cat-photos");
  const catFolders = await listStorageEntries(familyId);
  const photoPaths = (await Promise.all(catFolders.map(async (folder) => {
    const files = await listStorageEntries(`${familyId}/${folder.name}`);
    return files.map((file) => `${familyId}/${folder.name}/${file.name}`);
  }))).flat();

  for (let index = 0; index < photoPaths.length; index += 100) {
    const { error } = await bucket.remove(photoPaths.slice(index, index + 100));
    if (error) throw new Error(`Could not remove the family’s cat photos, so the family was not deleted: ${error.message}`);
  }

  const { error } = await client.rpc("delete_family", { p_family_id: familyId });
  if (error) throw error;
}

export async function listFamilyMembers(familyId: string): Promise<FamilyMember[]> {
  const { data, error } = await getClient()
    .from("family_members")
    .select("id,family_id,user_id,email,display_name,added_at")
    .eq("family_id", familyId)
    .order("added_at");
  if (error) throw error;
  const members = (data ?? []) as FamilyMember[];
  const userIds = members.flatMap((member) => member.user_id ? [member.user_id] : []);
  if (!userIds.length) return members;

  // Keep the family workspace usable before the profile-photo migration is applied.
  const { data: profiles, error: profilesError } = await getClient()
    .from("profiles")
    .select("id,avatar_url")
    .in("id", userIds);
  if (profilesError) return members;
  const avatars = new Map((profiles ?? []).map((profile) => [profile.id as string, profile.avatar_url as string | null]));
  return members.map((member) => ({ ...member, avatar_url: member.user_id ? avatars.get(member.user_id) ?? null : null }));
}

export async function addFamilyMember(familyId: string, email: string, displayName: string) {
  const { data, error } = await getClient().rpc("add_family_member", {
    p_family_id: familyId,
    p_email: email,
    p_display_name: displayName,
  });
  if (error) throw error;
  return data as FamilyMember;
}

export async function removeFamilyMember(memberId: string) {
  const { error } = await getClient().rpc("remove_family_member", { p_member_id: memberId });
  if (error) throw error;
}

export async function updateFamilyMemberName(memberId: string, displayName: string) {
  const { error } = await getClient().rpc("update_family_member_display_name", {
    p_member_id: memberId,
    p_display_name: displayName.trim(),
  });
  if (error) throw error;
}

export async function listCats(familyId: string): Promise<CloudCat[]> {
  const { data, error } = await getClient()
    .from("cats")
    .select("id,family_id,name,color,photo_path,archived_at")
    .eq("family_id", familyId)
    .is("archived_at", null)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as CloudCat[];
}

export async function addCat(familyId: string, name: string, color: string) {
  const { data: authData, error: authError } = await getClient().auth.getUser();
  if (authError) throw authError;
  if (!authData.user) throw new Error("Sign in again to add a cat.");
  const { data, error } = await getClient()
    .from("cats")
    .insert({ family_id: familyId, name: name.trim(), color, created_by: authData.user.id })
    .select("id,family_id,name,color,photo_path,archived_at")
    .single();
  if (error) throw error;
  return data as CloudCat;
}

export async function updateCat(catId: string, changes: Partial<Pick<CloudCat, "name" | "color" | "photo_path">>) {
  const { error } = await getClient().from("cats").update(changes).eq("id", catId);
  if (error) throw error;
}

export async function archiveCat(catId: string) {
  const { error } = await getClient().from("cats").update({ archived_at: new Date().toISOString() }).eq("id", catId);
  if (error) throw error;
}

export async function uploadCatPhoto(familyId: string, catId: string, file: File) {
  const client = getClient();
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${familyId}/${catId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await client.storage.from("cat-photos").upload(path, file, { upsert: false, contentType: file.type });
  if (uploadError) throw uploadError;
  const { error: updateError } = await client.from("cats").update({ photo_path: path }).eq("id", catId);
  if (updateError) throw updateError;
  return path;
}

export async function getCatPhotoUrl(path: string) {
  const { data, error } = await getClient().storage.from("cat-photos").createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

export async function listTargets(familyId: string): Promise<TargetRule[]> {
  const { data, error } = await getClient().from("target_rules").select("*").eq("family_id", familyId).is("effective_until", null);
  if (error) throw error;
  return (data ?? []) as TargetRule[];
}

export async function saveTarget(familyId: string, catId: string, metric: string, cadence: "daily" | "weekly" | "monthly", targetAmount: number, unit: string, effectiveFrom = new Date().toISOString().slice(0, 10)) {
  const { data: authData, error: authError } = await getClient().auth.getUser();
  if (authError) throw authError;
  if (!authData.user) throw new Error("Sign in again to change a target.");
  const { error } = await getClient().from("target_rules").upsert({
    family_id: familyId,
    cat_id: catId,
    metric,
    cadence,
    target_amount: targetAmount,
    unit,
    created_by: authData.user.id,
    effective_from: effectiveFrom,
  }, { onConflict: "cat_id,metric,cadence,effective_from" });
  if (error) throw error;
}

export async function listCareEvents(familyId: string, from: string, until: string): Promise<CareEvent[]> {
  const { data, error } = await getClient()
    .from("care_events")
    .select("id,family_id,cat_id,actor_user_id,metric,amount_delta,unit,detail,occurred_at,reverses_event_id,action_name_snapshot,action_icon_snapshot,action_unit_snapshot")
    .eq("family_id", familyId)
    .gte("occurred_at", from)
    .lt("occurred_at", until)
    .order("occurred_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as CareEvent[];
}

export async function recordCareEvent(event: Omit<CareEvent, "actor_user_id">) {
  const { data, error } = await getClient()
    .from("care_events")
    .insert(event)
    .select("id,family_id,cat_id,actor_user_id,metric,amount_delta,unit,detail,occurred_at,reverses_event_id,action_name_snapshot,action_icon_snapshot,action_unit_snapshot")
    .single();
  if (error) throw error;
  return data as CareEvent;
}
