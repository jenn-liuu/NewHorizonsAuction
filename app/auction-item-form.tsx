"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "@/supabase";
import {
  ITEM_CATEGORIES,
  isItemCategory,
  type ItemCategory,
} from "@/item-categories";
import {
  getItemPhotoExtension,
  isItemPhotoPath,
  ITEM_PHOTO_BUCKET,
  MAX_ITEM_PHOTOS,
  validateItemPhoto,
} from "@/item-photos";
import { useBidderAuth } from "./components/bidder-auth-provider";

type AccessState =
  | "checking"
  | "signed-out"
  | "not-admin"
  | "disabled"
  | "error"
  | "ready";

type AccessResult = {
  userId: string | null;
  state: AccessState;
  message: string;
};

type FormValues = {
  title: string;
  description: string;
  retailValue: string;
  startingBid: string;
  bidIncrement: string;
  donorWebsite: string;
  category: ItemCategory | "";
};

type ItemRecord = {
  id: string;
  title: string;
  description: string | null;
  retail_value: number | null;
  minimum_bid: number | null;
  bid_increment: number | null;
  donor_url: string | null;
  category: string | null;
  image_urls: string[] | null;
  status: "draft" | "published";
};

type ApiMessage = { message?: string; id?: string; item?: ItemRecord };

type ItemPhoto = {
  id: string;
  value: string | null;
  previewUrl: string;
  file?: File;
};

const EMPTY_PHOTOS: ItemPhoto[] = [];

const initialValues: FormValues = {
  title: "",
  description: "",
  retailValue: "",
  startingBid: "",
  bidIncrement: "",
  donorWebsite: "",
  category: "",
};

const fieldClassName =
  "mt-2 block w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2.5 text-sm text-stone-900 shadow-sm outline-none transition placeholder:text-stone-500 focus-visible:border-stone-950 focus-visible:ring-2 focus-visible:ring-stone-950/25";
const labelClassName = "block text-sm font-medium text-stone-800";

function formValuesFromItem(record: ItemRecord): FormValues {
  return {
    title: record.title,
    description: record.description ?? "",
    retailValue: record.retail_value?.toString() ?? "",
    startingBid: record.minimum_bid?.toString() ?? "",
    bidIncrement: record.bid_increment?.toString() ?? "",
    donorWebsite: record.donor_url ?? "",
    category: isItemCategory(record.category) ? record.category : "",
  };
}

export default function AuctionItemForm({ itemId }: { itemId?: string }) {
  const router = useRouter();
  const { user, loading: authLoading } = useBidderAuth();
  const [item, setItem] = useState(initialValues);
  const [savedValues, setSavedValues] = useState(initialValues);
  const [photos, setPhotos] = useState<ItemPhoto[]>(EMPTY_PHOTOS);
  const [savedPhotoValues, setSavedPhotoValues] = useState<string[]>([]);
  const [photoStatus, setPhotoStatus] = useState("");
  const [itemStatus, setItemStatus] = useState<"draft" | "published">("draft");
  const [loadedItemId, setLoadedItemId] = useState<string | null>(null);
  const [accessResult, setAccessResult] = useState<AccessResult | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error" | "warning";
    message: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const objectUrls = useRef(new Set<string>());
  const activeItemId = useRef(itemId ?? null);
  const photoSnapshot = photos.map((photo) => photo.value ?? `new:${photo.id}`);
  const currentUserId = user?.id ?? null;
  const access: AccessState = authLoading
    ? "checking"
    : !currentUserId
      ? "signed-out"
      : !supabase
        ? "disabled"
        : accessResult?.userId === currentUserId
          ? accessResult.state
          : "checking";
  const accessMessage =
    !supabase
      ? "Supabase is not configured in this environment."
      : accessResult?.userId === currentUserId
        ? accessResult.message
        : "";
  const isDirty =
    (!itemId || loadedItemId === itemId) &&
    (JSON.stringify(item) !== JSON.stringify(savedValues) ||
      JSON.stringify(photoSnapshot) !== JSON.stringify(savedPhotoValues));
  const canSave =
    access === "ready" && !saving && (!itemId || loadedItemId === itemId);

  useEffect(
    () => () => {
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
      objectUrls.current.clear();
    },
    [],
  );

  useEffect(() => {
    const userId = currentUserId;
    if (authLoading || !userId || !supabase) return;

    let active = true;
    const client = supabase;

    async function checkAccess() {
      try {
        const { data, error } = await client.auth.getSession();
        if (!active) return;
        if (error) {
          setAccessResult({
            userId,
            state: "error",
            message: "Could not verify your sign-in session. Please sign in again.",
          });
          return;
        }
        if (!data.session) {
          setAccessResult({
            userId,
            state: "signed-out",
            message: "Your session has expired. Please sign in again.",
          });
          return;
        }

        const response = await fetch("/api/admin/items", {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          cache: "no-store",
        });
        const result = (await response.json()) as ApiMessage;
        if (!active) return;
        if (response.ok) {
          setAccessResult({ userId, state: "ready", message: "" });
          return;
        }
        setAccessResult({
          userId,
          state:
            response.status === 401
              ? "signed-out"
              : response.status === 403
                ? "not-admin"
                : response.status === 503
                  ? "disabled"
                  : "error",
          message:
            result.message ??
            "Could not verify admin access. Saving is disabled.",
        });
      } catch {
        if (!active) return;
        setAccessResult({
          userId,
          state: "error",
          message:
            "Could not reach the server to verify admin access. Saving is disabled.",
        });
      }
    }

    void checkAccess();
    return () => {
      active = false;
    };
  }, [authLoading, currentUserId]);

  useEffect(() => {
    if (access === "signed-out") router.replace("/login");
  }, [access, router]);

  useEffect(() => {
    if (!itemId || access !== "ready" || !supabase) return;

    const requestedItemId = itemId;
    let active = true;
    const client = supabase;

    async function loadItem() {
      try {
        const { data, error } = await client.auth.getSession();
        if (error || !data.session) {
          throw new Error("Your session has expired. Please sign in again.");
        }
        const response = await fetch(
          `/api/admin/items/${encodeURIComponent(requestedItemId)}`,
          {
            headers: { Authorization: `Bearer ${data.session.access_token}` },
            cache: "no-store",
          },
        );
        const result = (await response.json()) as ApiMessage;
        if (!response.ok || !result.item) {
          throw new Error(
            result.message ?? "This auction item could not be loaded.",
          );
        }
        if (!active) return;
        const values = formValuesFromItem(result.item);
        const imageValues = Array.isArray(result.item.image_urls)
          ? result.item.image_urls.filter(
              (imageUrl): imageUrl is string =>
                typeof imageUrl === "string",
            )
          : [];
        let previewFailure = false;
        const loadedPhotos = await Promise.all(
          imageValues.map(async (value): Promise<ItemPhoto> => {
            if (!isItemPhotoPath(value)) {
              return {
                id: crypto.randomUUID(),
                value,
                previewUrl: value,
              };
            }

            const { data: image, error: imageError } = await client.storage
              .from(ITEM_PHOTO_BUCKET)
              .download(value);
            if (imageError || !image) {
              previewFailure = true;
              return {
                id: crypto.randomUUID(),
                value,
                previewUrl: "",
              };
            }

            const previewUrl = URL.createObjectURL(image);
            objectUrls.current.add(previewUrl);
            return { id: crypto.randomUUID(), value, previewUrl };
          }),
        );
        if (!active) {
          for (const photo of loadedPhotos) {
            if (objectUrls.current.delete(photo.previewUrl)) {
              URL.revokeObjectURL(photo.previewUrl);
            }
          }
          return;
        }
        activeItemId.current = requestedItemId;
        setPhotos(loadedPhotos);
        setSavedPhotoValues(imageValues);
        setItem(values);
        setSavedValues(values);
        setItemStatus(result.item.status);
        setLoadedItemId(requestedItemId);
        setFeedback(null);

        if (!active) return;
        if (previewFailure) {
          setFeedback({
            kind: "error",
            message:
              "Some saved photo previews could not be loaded. Their image entries are preserved when you save.",
          });
        }
      } catch (error) {
        if (!active) return;
        setFeedback({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "This auction item could not be loaded.",
        });
      }
    }

    void loadItem();
    return () => {
      active = false;
    };
  }, [access, itemId]);

  useEffect(() => {
    if (!isDirty || saving) return;

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const warnBeforeLinkNavigation = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      if (
        link.target === "_blank" ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const destination = new URL(link.href, window.location.href);
      if (
        destination.origin !== window.location.origin ||
        destination.href === window.location.href
      ) {
        return;
      }
      if (!window.confirm("You have unsaved changes. Leave this form?")) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };
    let restoringHistory = false;
    const warnBeforeHistoryNavigation = () => {
      if (restoringHistory) {
        restoringHistory = false;
        return;
      }
      if (!window.confirm("You have unsaved changes. Leave this form?")) {
        restoringHistory = true;
        window.history.forward();
      }
    };

    window.addEventListener("beforeunload", warnBeforeUnload);
    window.addEventListener("popstate", warnBeforeHistoryNavigation);
    document.addEventListener("click", warnBeforeLinkNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      window.removeEventListener("popstate", warnBeforeHistoryNavigation);
      document.removeEventListener("click", warnBeforeLinkNavigation, true);
    };
  }, [isDirty, saving]);

  function updateField<Field extends keyof FormValues>(
    field: Field,
    value: FormValues[Field],
  ) {
    setItem((current) => ({ ...current, [field]: value }));
  }

  function addPhotoFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const selected = Array.from(files);
    const validationMessage =
      photos.length + selected.length > MAX_ITEM_PHOTOS
        ? `You can add up to ${MAX_ITEM_PHOTOS} photos per item.`
        : selected
            .map(validateItemPhoto)
            .find((message): message is string => message !== null);
    if (validationMessage) {
      setFeedback({ kind: "error", message: validationMessage });
      return;
    }

    const additions = selected.map((file): ItemPhoto => {
      const previewUrl = URL.createObjectURL(file);
      objectUrls.current.add(previewUrl);
      return { id: crypto.randomUUID(), value: null, previewUrl, file };
    });
    setPhotos((current) => [...current, ...additions]);
    setFeedback(null);
  }

  function removePhoto(photoId: string) {
    const removed = photos.find((photo) => photo.id === photoId);
    if (!removed) return;
    setPhotos((current) => current.filter((photo) => photo.id !== photoId));
    if (objectUrls.current.delete(removed.previewUrl)) {
      URL.revokeObjectURL(removed.previewUrl);
    }
  }

  function movePhoto(photoId: string, direction: -1 | 1) {
    setPhotos((current) => {
      const index = current.findIndex((photo) => photo.id === photoId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      const reordered = [...current];
      [reordered[index], reordered[nextIndex]] = [
        reordered[nextIndex],
        reordered[index],
      ];
      return reordered;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || !supabase) return;

    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const action = submitter?.value;
    if (
      action !== "draft" &&
      action !== "draft-and-add" &&
      action !== "publish"
    ) {
      return;
    }

    setSaving(true);
    setFeedback(null);
    setPhotoStatus("Saving item details…");
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) {
        setFeedback({
          kind: "error",
          message:
            "Your session could not be verified. Sign in again; your entries are still here.",
        });
        if (currentUserId) {
          setAccessResult({
            userId: currentUserId,
            state: "signed-out",
            message: "Your session has expired. Please sign in again.",
          });
        }
        return;
      }

      const intent = action === "publish" ? "publish" : "draft";
      const newPhotosSelected = photos.some((photo) => photo.file);
      let targetId = activeItemId.current;
      if (!targetId && newPhotosSelected) {
        const createResponse = await fetch("/api/admin/items", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${data.session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...item, intent: "draft", imageUrls: [] }),
        });
        const created = (await createResponse.json()) as ApiMessage;
        if (!createResponse.ok || !created.id) {
          setFeedback({
            kind: "error",
            message:
              created.message ??
              "The draft could not be saved before uploading photos. Your entries are still here.",
          });
          return;
        }
        targetId = created.id;
        activeItemId.current = targetId;
        setItemStatus("draft");
      }

      let photoList = [...photos];
      const photosToUpload = photoList.filter((photo) => photo.file);
      for (const [index, photo] of photosToUpload.entries()) {
        const file = photo.file;
        const extension = file ? getItemPhotoExtension(file.type) : null;
        const fileError = file ? validateItemPhoto(file) : null;
        if (!file || !extension || fileError || !targetId) {
          setFeedback({
            kind: "error",
            message:
              fileError ??
              "A photo could not be prepared for upload. Your form data is still here.",
          });
          return;
        }

        setPhotoStatus(
          `Uploading photo ${index + 1} of ${photosToUpload.length}…`,
        );
        const objectPath = `items/${targetId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from(ITEM_PHOTO_BUCKET)
          .upload(objectPath, file, {
            contentType: file.type,
            upsert: false,
          });
        if (uploadError) {
          setPhotos(photoList);
          setFeedback({
            kind: "error",
            message:
              `A photo could not be uploaded: ${uploadError.message} Your text and photo selections are still here.`,
          });
          return;
        }

        photoList = photoList.map((current) =>
          current.id === photo.id
            ? { ...current, value: objectPath, file: undefined }
            : current,
        );
        setPhotos(photoList);
      }

      const imageUrls = photoList.map((photo) => photo.value);
      if (imageUrls.some((value) => value === null)) {
        setFeedback({
          kind: "error",
          message:
            "A photo is still waiting to upload. Your form data is still here.",
        });
        return;
      }
      const finalImageUrls = imageUrls.filter(
        (value): value is string => value !== null,
      );
      const photoValuesChanged =
        JSON.stringify(photoSnapshot) !== JSON.stringify(savedPhotoValues);
      const payload = {
        ...item,
        intent,
        ...(!targetId || photoValuesChanged
          ? { imageUrls: finalImageUrls }
          : {}),
      };
      const response = await fetch(
        targetId ? `/api/admin/items/${encodeURIComponent(targetId)}` : "/api/admin/items",
        {
          method: targetId ? "PATCH" : "POST",
          headers: {
            Authorization: `Bearer ${data.session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      const result = (await response.json()) as ApiMessage;
      if (!response.ok || !result.id) {
        setFeedback({
          kind: "error",
          message:
            result.message ??
            "The item was not saved. Your entries are still here.",
        });
        if (response.status === 401 || response.status === 403) {
          setAccessResult({
            userId: currentUserId,
            state: response.status === 403 ? "not-admin" : "signed-out",
            message: result.message ?? "Admin access could not be verified.",
          });
        } else if (response.status === 503) {
          setAccessResult({
            userId: currentUserId,
            state: "disabled",
            message: result.message ?? "Saving is not enabled yet.",
          });
        }
        return;
      }

      if (action === "draft-and-add") {
        for (const photo of photos) {
          if (objectUrls.current.delete(photo.previewUrl)) {
            URL.revokeObjectURL(photo.previewUrl);
          }
        }
        setPhotos(EMPTY_PHOTOS);
        setSavedPhotoValues([]);
        activeItemId.current = null;
        setItem(initialValues);
        setSavedValues(initialValues);
        setItemStatus("draft");
        setLoadedItemId(null);
        setPhotoStatus("");
        setFeedback({
          kind: "success",
          message: "Draft saved. You can start another item now.",
        });
        router.push("/admin/items/new");
        return;
      }

      setSavedValues(item);
      setSavedPhotoValues(finalImageUrls);
      activeItemId.current = result.id;
      setLoadedItemId(result.id);
      setItemStatus(intent === "publish" ? "published" : "draft");
      setPhotoStatus("");
      setFeedback({
        kind: "success",
        message: result.message ?? "Item saved successfully.",
      });
      if (!itemId) router.replace(`/admin/items/${encodeURIComponent(result.id)}`);
    } catch {
      setFeedback({
        kind: "error",
        message:
          "We could not reach the server. The item was not saved, and your entries are still here.",
      });
    } finally {
      setSaving(false);
      setPhotoStatus("");
    }
  }

  if (access !== "ready") {
    const isVerifying = access === "checking";
    const isSignedOut = access === "signed-out";
    const heading =
      access === "not-admin"
        ? "Access denied"
        : isVerifying
          ? "Checking access"
          : isSignedOut
            ? "Sign in required"
            : "Admin access could not be verified";

    return (
      <main className="min-h-screen bg-stone-50 px-4 py-10 font-sans text-stone-900 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl rounded-xl border border-stone-300 bg-white p-6 shadow-sm">
          <h1 className="font-serif text-2xl font-semibold text-stone-950">
            {heading}
          </h1>
          <p
            className="mt-3 text-sm leading-6 text-stone-700"
            role={isVerifying || isSignedOut ? "status" : "alert"}
          >
            {isVerifying
              ? "Checking your sign-in and approved-admin access…"
              : isSignedOut
                ? "Redirecting to sign in…"
                : accessMessage ||
                  (access === "not-admin"
                    ? "This account is not an approved auction admin."
                    : "Please try again after access can be verified.")}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10 font-sans text-stone-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-7 overflow-hidden rounded-xl bg-stone-950 text-white shadow-sm">
          <div className="border-b border-stone-700 px-5 py-4 sm:px-7">
            <p className="font-serif text-xl font-semibold tracking-wide">
              New Horizons
            </p>
            <p className="mt-1 text-xs tracking-wide text-stone-300">
              Annual auction · Item preparation
            </p>
          </div>
        </div>

        <header className="mb-8">
          <Link
            className="text-sm font-semibold text-stone-700 underline underline-offset-2"
            href="/admin/items"
          >
            Back to item management
          </Link>
          <h1 className="mt-4 font-serif text-3xl font-semibold tracking-tight text-stone-950 sm:text-4xl">
            {itemId ? "Edit auction item" : "Prepare your auction item"}
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-stone-700">
            Save an incomplete draft to return to it later, or complete all
            required fields to publish it to the public catalog.
          </p>
          {itemId && loadedItemId === itemId && (
            <p className="mt-3 text-sm font-medium text-stone-700">
              Current status: {itemStatus === "draft" ? "Draft" : "Published"}
            </p>
          )}
        </header>

        {itemId &&
          access === "ready" &&
          loadedItemId !== itemId &&
          !feedback && (
          <p className="mb-4 text-sm text-stone-700" role="status">
            Loading saved item…
          </p>
          )}

        <form
          className="overflow-hidden rounded-xl border border-stone-300 bg-white shadow-md shadow-stone-900/5"
          onSubmit={submit}
        >
          <section
            aria-labelledby="item-details-heading"
            className="space-y-6 p-5 sm:p-8"
          >
            <div>
              <h2
                className="font-serif text-xl font-semibold text-stone-950"
                id="item-details-heading"
              >
                Item details
              </h2>
              <p className="mt-1 text-sm leading-6 text-stone-700">
                Tell bidders what makes this donated item special.
              </p>
            </div>

            <div>
              <label className={labelClassName} htmlFor="title">
                Item title <span className="text-rose-700">*</span>
              </label>
              <input
                autoComplete="off"
                className={fieldClassName}
                disabled={!canSave}
                id="title"
                maxLength={200}
                name="title"
                onChange={(event) => updateField("title", event.target.value)}
                placeholder="For example, Leather western saddle"
                required
                value={item.title}
              />
            </div>

            <div>
              <label className={labelClassName} htmlFor="description">
                Description{" "}
                <span className="font-normal text-stone-500">
                  (required to publish)
                </span>
              </label>
              <textarea
                className={fieldClassName}
                disabled={!canSave}
                id="description"
                maxLength={5000}
                name="description"
                onChange={(event) =>
                  updateField("description", event.target.value)
                }
                placeholder="Share the details bidders will want to know."
                required
                rows={4}
                value={item.description}
              />
            </div>

            <div className="max-w-sm">
              <label className={labelClassName} htmlFor="donorWebsite">
                Donor website{" "}
                <span className="font-normal text-stone-500">(optional)</span>
              </label>
              <input
                className={fieldClassName}
                disabled={!canSave}
                id="donorWebsite"
                maxLength={2048}
                name="donorWebsite"
                onChange={(event) =>
                  updateField("donorWebsite", event.target.value)
                }
                placeholder="https://example.com"
                type="url"
                value={item.donorWebsite}
              />
            </div>

            <div className="max-w-sm">
              <label className={labelClassName} htmlFor="category">
                Category <span className="text-rose-700">*</span>
              </label>
              <select
                className={fieldClassName}
                disabled={!canSave}
                id="category"
                name="category"
                onChange={(event) => {
                  const category = ITEM_CATEGORIES.find(
                    (candidate) => candidate === event.target.value,
                  );
                  updateField("category", category ?? "");
                }}
                required
                value={item.category}
              >
                <option value="">Choose a category</option>
                {ITEM_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>

            <section
              aria-labelledby="item-photos-heading"
              className="space-y-4 rounded-lg border border-stone-200 bg-stone-50 p-4 sm:p-5"
            >
              <div>
                <h3
                  className="font-semibold text-stone-950"
                  id="item-photos-heading"
                >
                  Item photos
                </h3>
                <p className="mt-1 text-sm leading-6 text-stone-700">
                  Add up to {MAX_ITEM_PHOTOS} JPEG, PNG, or WebP photos, up to
                  5 MB each. The first photo is the main catalog photo; use the
                  arrows to reorder.
                </p>
                <p className="mt-1 text-sm leading-6 text-stone-700">
                  Draft photos stay private. A photo is available to catalog
                  visitors only while its item is published. Existing external
                  sample images are kept as-is.
                </p>
              </div>
              <div>
                <label className={labelClassName} htmlFor="itemPhotos">
                  Choose photos
                </label>
                <input
                  accept="image/jpeg,image/png,image/webp"
                  className={`${fieldClassName} file:mr-3 file:rounded-md file:border-0 file:bg-stone-200 file:px-3 file:py-1.5 file:text-sm file:font-semibold`}
                  disabled={!canSave || photos.length >= MAX_ITEM_PHOTOS}
                  id="itemPhotos"
                  multiple
                  onChange={(event) => {
                    addPhotoFiles(event.currentTarget.files);
                    event.currentTarget.value = "";
                  }}
                  type="file"
                />
              </div>
              {photoStatus && (
                <p className="text-sm text-stone-700" role="status">
                  {photoStatus}
                </p>
              )}
              {photos.length > 0 && (
                <ol className="grid gap-4 sm:grid-cols-2">
                  {photos.map((photo, index) => (
                    <li
                      className="overflow-hidden rounded-lg border border-stone-300 bg-white"
                      key={photo.id}
                    >
                      {photo.previewUrl ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            alt={`Item photo ${index + 1}`}
                            className="aspect-[4/3] w-full bg-stone-100 object-cover"
                            src={photo.previewUrl}
                          />
                        </>
                      ) : (
                        <div
                          aria-label={`Preview unavailable for item photo ${index + 1}`}
                          className="flex aspect-[4/3] items-center justify-center bg-stone-100 px-4 text-center text-sm text-stone-600"
                          role="img"
                        >
                          Preview unavailable; saved image will be preserved
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2 p-3">
                        <p className="text-sm font-semibold text-stone-800">
                          {index === 0 ? "Main photo" : `Photo ${index + 1}`}
                        </p>
                        <div className="flex gap-2">
                          <button
                            aria-label={`Move photo ${index + 1} earlier`}
                            className="min-h-9 rounded-md border border-stone-400 px-3 text-sm font-medium disabled:opacity-50"
                            disabled={!canSave || index === 0}
                            onClick={() => movePhoto(photo.id, -1)}
                            type="button"
                          >
                            ↑
                          </button>
                          <button
                            aria-label={`Move photo ${index + 1} later`}
                            className="min-h-9 rounded-md border border-stone-400 px-3 text-sm font-medium disabled:opacity-50"
                            disabled={!canSave || index === photos.length - 1}
                            onClick={() => movePhoto(photo.id, 1)}
                            type="button"
                          >
                            ↓
                          </button>
                          <button
                            aria-label={`Remove photo ${index + 1}`}
                            className="min-h-9 rounded-md border border-rose-300 px-3 text-sm font-medium text-rose-800 hover:bg-rose-50 disabled:opacity-50"
                            disabled={!canSave}
                            onClick={() => removePhoto(photo.id)}
                            type="button"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </section>

          <section
            aria-labelledby="bidding-heading"
            className="space-y-6 border-t border-stone-200 p-5 sm:p-8"
          >
            <div>
              <h2
                className="font-serif text-xl font-semibold text-stone-950"
                id="bidding-heading"
              >
                Value and bidding
              </h2>
              <p className="mt-1 text-sm leading-6 text-stone-700">
                Amounts are entered and stored in dollars. They may be left
                blank in a draft and are required to publish.
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              {(
                [
                  ["retailValue", "Retail value ($)", "0.00", "0"],
                  ["startingBid", "Starting bid ($)", "0.00", "0"],
                  ["bidIncrement", "Bid increment ($)", "25.00", "0.01"],
                ] as const
              ).map(([field, label, placeholder, minimum]) => (
                <div key={field}>
                  <label className={labelClassName} htmlFor={field}>
                    {label}{" "}
                    <span className="font-normal text-stone-500">
                      (required to publish)
                    </span>
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-stone-500">
                      $
                    </span>
                    <input
                      className={`${fieldClassName} pl-8`}
                      disabled={!canSave}
                      id={field}
                      inputMode="decimal"
                      min={minimum}
                      name={field}
                      onChange={(event) =>
                        updateField(field, event.target.value)
                      }
                      placeholder={placeholder}
                      required
                      step="0.01"
                      type="number"
                      value={item[field]}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section
            aria-labelledby="access-heading"
            className="space-y-4 border-t border-stone-200 p-5 sm:p-8"
          >
            <h2
              className="font-serif text-xl font-semibold text-stone-950"
              id="access-heading"
            >
              Save access
            </h2>
            <p className="text-sm text-emerald-800" role="status">
              Approved-admin membership is verified. Item access is also
              enforced by database RLS.
            </p>
            {feedback && (
              <p
                className={`rounded-lg border p-4 text-sm ${
                  feedback.kind === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : feedback.kind === "warning"
                      ? "border-amber-200 bg-amber-50 text-amber-950"
                      : "border-rose-200 bg-rose-50 text-rose-800"
                }`}
                role={feedback.kind === "error" ? "alert" : "status"}
              >
                {feedback.message}
              </p>
            )}
          </section>

          <footer className="flex flex-col gap-3 border-t border-stone-200 bg-stone-50 p-5 sm:flex-row sm:items-center sm:justify-end sm:px-8">
            <button
              aria-busy={saving}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-400 bg-white px-5 py-2.5 text-sm font-semibold text-stone-900 transition hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
              disabled={!canSave}
              formNoValidate
              name="intent"
              type="submit"
              value="draft"
            >
              {saving ? "Saving…" : "Save draft"}
            </button>
            <button
              aria-busy={saving}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-400 bg-white px-5 py-2.5 text-sm font-semibold text-stone-900 transition hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
              disabled={!canSave}
              formNoValidate
              name="intent"
              type="submit"
              value="draft-and-add"
            >
              Save draft and add another
            </button>
            <button
              aria-busy={saving}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-stone-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-700"
              disabled={!canSave}
              name="intent"
              type="submit"
              value="publish"
            >
              {saving
                ? "Saving…"
                : itemStatus === "published"
                  ? "Save and publish"
                  : "Publish"}
            </button>
          </footer>
        </form>
      </div>
    </main>
  );
}
