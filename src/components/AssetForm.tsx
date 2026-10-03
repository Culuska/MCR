import { saveAsset } from "@/actions/assets";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { label } from "@/lib/domain";
import { toDateInput } from "@/lib/money";
import type { Asset } from "@/generated/prisma/client";

export const ASSET_TYPES = ["Excavator", "Wheel loader", "Bulldozer", "Crane", "Concrete mixer", "Generator", "Compactor", "Water tanker", "Tipper truck", "Pickup", "Trailer", "Other"];

export function AssetForm({ asset, goTo }: { asset?: Asset; goTo: string }) {
  return (
    <ActionForm action={saveAsset} goTo={goTo} resetOnOk>
      {asset && <input type="hidden" name="id" value={asset.id} />}
      <div className="fields">
        <Field name="name" label="Name"><input id="name" name="name" required defaultValue={asset?.name} placeholder="CAT 320 excavator" /></Field>
        <Field name="kind" label="Kind">
          <select id="kind" name="kind" defaultValue={asset?.kind ?? "EQUIPMENT"}>
            <option value="EQUIPMENT">Equipment (hours are logged)</option>
            <option value="VEHICLE">Vehicle (kilometres are logged)</option>
          </select>
        </Field>
        <Field name="type" label="Type">
          <input id="type" name="type" list="asset-types" required defaultValue={asset?.type} placeholder="Excavator, Tipper truck" />
          <datalist id="asset-types">{ASSET_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
        </Field>
        <Field name="registration" label="Plate number" hint="Required for vehicles."><input id="registration" name="registration" defaultValue={asset?.registration ?? ""} /></Field>
        <Field name="ownership" label="Owned or hired">
          <select id="ownership" name="ownership" defaultValue={asset?.ownership ?? "OWNED"}><option value="OWNED">Owned by the company</option><option value="HIRED">Hired in</option></select>
        </Field>
        <Field name="purchasePrice" label="Purchase price (USD)"><input id="purchasePrice" name="purchasePrice" type="number" step="0.01" min="0" defaultValue={asset?.purchasePrice?.toString() ?? ""} /></Field>
        <Field name="fuelType" label="Fuel"><input id="fuelType" name="fuelType" defaultValue={asset?.fuelType ?? "Diesel"} /></Field>
        <Field name="driver" label="Usual driver or operator"><input id="driver" name="driver" defaultValue={asset?.driver ?? ""} /></Field>
        <Field name="status" label="Status">
          <select id="status" name="status" defaultValue={asset?.status === "IN_USE" ? "AVAILABLE" : asset?.status ?? "AVAILABLE"}>
            {["AVAILABLE", "UNDER_REPAIR", "RETIRED"].map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </Field>
        <Field name="nextServiceDate" label="Next service due"><input id="nextServiceDate" name="nextServiceDate" type="date" defaultValue={toDateInput(asset?.nextServiceDate)} /></Field>
        <Field name="insuranceExpiry" label="Insurance expires"><input id="insuranceExpiry" name="insuranceExpiry" type="date" defaultValue={toDateInput(asset?.insuranceExpiry)} /></Field>
        <Field name="notes" label="Notes" wide><input id="notes" name="notes" defaultValue={asset?.notes ?? ""} /></Field>
      </div>
      <div className="row"><Submit>{asset ? "Save changes" : "Add asset"}</Submit></div>
    </ActionForm>
  );
}
