import { connection } from "next/server";
import { Suspense } from "react";
import {
  CLASS_DAY_DATE_PARAM,
  classDayDateParam,
} from "~/components/class-day/routes";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { schoolHomeSeed } from "~/lib/school/page-seed.server";
import SchoolHomePage from "./page-content";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [CLASS_DAY_DATE_PARAM]?: string | string[] }>;
}) {
  await connection();
  const raw = (await searchParams)[CLASS_DAY_DATE_PARAM];
  const date = classDayDateParam(Array.isArray(raw) ? raw[0] : raw);
  const { seed, claims } = schoolHomeSeed(date);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <SchoolHomePage />
      </SWRServerSeed>
    </Suspense>
  );
}
