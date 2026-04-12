import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export async function getCampaignsList() {
  try {
    const result = await db.execute(sql`
      SELECT
        c.id,
        c.name,
        c.status,
        c.start_date,
        c.end_date,
        c.duration_days,
        c.platforms,
        c.theme,
        c.summary,
        c.target_reach,
        c.actual_reach,
        c.engagement_rate,
        c.conversion_rate,
        c.budget_allocated,
        COALESCE(cc.content_count, 0) AS content_count
      FROM campaigns c
      LEFT JOIN (
        SELECT campaign_id, COUNT(*) AS content_count
        FROM content_pipeline
        WHERE campaign_id IS NOT NULL
        GROUP BY campaign_id
      ) cc ON c.id = cc.campaign_id
      ORDER BY c.start_date DESC NULLS LAST
    `);
    return result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      startDate: r.start_date,
      endDate: r.end_date,
      durationDays: r.duration_days,
      platforms: r.platforms || [],
      theme: r.theme,
      summary: r.summary,
      targetReach: r.target_reach,
      actualReach: r.actual_reach,
      engagementRate: r.engagement_rate,
      conversionRate: r.conversion_rate,
      budgetAllocated: r.budget_allocated,
      contentCount: Number(r.content_count) || 0,
    }));
  } catch {
    return [];
  }
}

export async function getCampaignDetail(campaignId: string) {
  try {
    const campaignResult = await db.execute(sql`
      SELECT id, name, status, start_date, end_date, duration_days,
        platforms, content_types, automation_workflows, content_frequency,
        theme, summary, demographics, psychographics, seo_keywords,
        content_waterfall, target_reach, actual_reach, engagement_rate,
        conversion_rate, viral_score, budget_allocated, projects,
        content_pipeline, created_at, updated_at
      FROM campaigns
      WHERE id = ${campaignId}
      LIMIT 1
    `);
    if (campaignResult.rows.length === 0) return null;

    const c = campaignResult.rows[0] as any;
    const campaign = {
      id: c.id,
      name: c.name,
      status: c.status,
      startDate: c.start_date,
      endDate: c.end_date,
      durationDays: c.duration_days,
      platforms: c.platforms || [],
      contentTypes: c.content_types || [],
      automationWorkflows: c.automation_workflows || [],
      contentFrequency: c.content_frequency,
      theme: c.theme,
      summary: c.summary,
      demographics: c.demographics,
      psychographics: c.psychographics,
      seoKeywords: c.seo_keywords || [],
      contentWaterfall: c.content_waterfall,
      targetReach: c.target_reach,
      actualReach: c.actual_reach,
      engagementRate: c.engagement_rate,
      conversionRate: c.conversion_rate,
      viralScore: c.viral_score,
      budgetAllocated: c.budget_allocated,
      projects: c.projects || [],
      contentPipeline: c.content_pipeline || [],
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    };

    const contentResult = await db.execute(sql`
      SELECT id, name, status, pillar, funnel_stage, platforms, format,
        publish_date, reach, engagement, engagement_rate
      FROM content_pipeline
      WHERE campaign_id = ${campaignId}
      ORDER BY publish_date DESC NULLS LAST
    `);
    const contentItems = contentResult.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      pillar: r.pillar,
      funnelStage: r.funnel_stage,
      platforms: r.platforms || [],
      format: r.format || [],
      publishDate: r.publish_date,
      reach: r.reach,
      engagement: r.engagement,
      engagementRate: r.engagement_rate,
    }));

    return { campaign, contentItems };
  } catch {
    return null;
  }
}

export async function getContentPipeline() {
  try {
    const result = await db.execute(sql`
      SELECT
        cp.id,
        cp.name,
        cp.status,
        cp.pillar,
        cp.funnel_stage,
        cp.platforms,
        cp.format,
        cp.publish_date,
        cp.reach,
        cp.engagement,
        cp.engagement_rate,
        c.name AS campaign_name
      FROM content_pipeline cp
      LEFT JOIN campaigns c ON cp.campaign_id = c.id
      ORDER BY cp.publish_date DESC NULLS LAST
    `);
    return result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      pillar: r.pillar,
      funnelStage: r.funnel_stage,
      platforms: r.platforms || [],
      format: r.format || [],
      publishDate: r.publish_date,
      reach: r.reach,
      engagement: r.engagement,
      engagementRate: r.engagement_rate,
      campaignName: r.campaign_name,
    }));
  } catch {
    return [];
  }
}
