"use client";

/**
 * People tab shell (Phase-3 ⑧) — the focused-property view of the merged module.
 * Staff & attendance and Payroll under one tab strip. The screens are rendered by
 * the server page and passed in as slots, so this stays a thin client boundary just
 * for the tab state; a `?tab=payroll` deep-link opens the payroll tab.
 */
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export function PeopleTabs({
  staffSlot,
  payrollSlot,
  defaultTab = "staff",
}: {
  staffSlot: React.ReactNode;
  payrollSlot: React.ReactNode | null;
  defaultTab?: string;
}) {
  return (
    <Tabs defaultValue={payrollSlot ? defaultTab : "staff"} className="w-full">
      <TabsList>
        <TabsTrigger value="staff" data-testid="people-tab-staff">Staff &amp; attendance</TabsTrigger>
        {payrollSlot ? <TabsTrigger value="payroll" data-testid="people-tab-payroll">Payroll</TabsTrigger> : null}
      </TabsList>
      <TabsContent value="staff">{staffSlot}</TabsContent>
      {payrollSlot ? <TabsContent value="payroll">{payrollSlot}</TabsContent> : null}
    </Tabs>
  );
}
