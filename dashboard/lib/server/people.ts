import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export type PersonListItem = {
  id: string;
  name: string;
  firstName: string | null;
  email: string | null;
  relationshipStatus: string | null;
  city: string | null;
  lastConnectedDate: string | null;
  connectionFrequencyDays: number | null;
  networkingProfile: string | null;
  professionalDomain: string | null;
  lastInteractionSentiment: string | null;
};

export async function getPeopleList(): Promise<PersonListItem[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, name, first_name, email, relationship_status, city,
        last_connected_date, connection_frequency_days, networking_profile,
        professional_domain, last_interaction_sentiment
      FROM people
      ORDER BY name ASC
    `);
    return result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      firstName: r.first_name,
      email: r.email,
      relationshipStatus: r.relationship_status,
      city: r.city,
      lastConnectedDate: r.last_connected_date,
      connectionFrequencyDays: r.connection_frequency_days,
      networkingProfile: r.networking_profile,
      professionalDomain: r.professional_domain,
      lastInteractionSentiment: r.last_interaction_sentiment,
    }));
  } catch {
    return [];
  }
}

export async function getPersonDetail(id: string) {
  try {
    const result = await db.execute(sql`
      SELECT id, name, first_name, custom_name, summary, strategic_context,
        engagement_blueprint, professional_domain, origin_context,
        key_personal_intel, email, connection_frequency_days,
        last_connected_date, reconnect_by, networking_profile,
        relationship_status, value_exchange_balance, core_shadow,
        developmental_altitude, aspirational_drive, temporal_focus,
        primary_center_of_intelligence, dominant_power_strategy,
        city, primary_conflict_style, timezone, desired_trajectory,
        stability_profile, last_interaction_sentiment, explanatory_style,
        influence_toolkit, projects
      FROM people WHERE id = ${id} LIMIT 1
    `);
    if (result.rows.length === 0) return null;
    const r = result.rows[0] as any;
    return {
      id: r.id,
      name: r.name,
      firstName: r.first_name,
      customName: r.custom_name,
      summary: r.summary,
      strategicContext: r.strategic_context,
      engagementBlueprint: r.engagement_blueprint,
      professionalDomain: r.professional_domain,
      originContext: r.origin_context,
      keyPersonalIntel: r.key_personal_intel,
      email: r.email,
      connectionFrequencyDays: r.connection_frequency_days,
      lastConnectedDate: r.last_connected_date,
      reconnectBy: r.reconnect_by,
      networkingProfile: r.networking_profile,
      relationshipStatus: r.relationship_status,
      valueExchangeBalance: r.value_exchange_balance,
      coreShadow: r.core_shadow,
      developmentalAltitude: r.developmental_altitude,
      aspirationalDrive: r.aspirational_drive,
      temporalFocus: r.temporal_focus,
      primaryCenterOfIntelligence: r.primary_center_of_intelligence,
      dominantPowerStrategy: r.dominant_power_strategy,
      city: r.city,
      primaryConflictStyle: r.primary_conflict_style,
      timezone: r.timezone,
      desiredTrajectory: r.desired_trajectory,
      stabilityProfile: r.stability_profile,
      lastInteractionSentiment: r.last_interaction_sentiment,
      explanatoryStyle: r.explanatory_style,
      influenceToolkit: r.influence_toolkit,
      projects: r.projects,
    };
  } catch {
    return null;
  }
}
