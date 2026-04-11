import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { contentPipeline } from '@/drizzle/schema/lifeos/content_pipeline';
import { eq } from 'drizzle-orm';
import { ContentEditorClient } from './content-editor-client';

interface ContentDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ContentDetailPage({ params }: ContentDetailPageProps) {
  const { id } = await params;

  const result = await db
    .select()
    .from(contentPipeline)
    .where(eq(contentPipeline.id, id))
    .limit(1);

  if (result.length === 0) {
    notFound();
  }

  const item = result[0];

  return (
    <ContentEditorClient
      content={{
        id: item.id,
        name: item.name,
        status: item.status,
        pillar: item.pillar,
        funnelStage: item.funnelStage,
        tone: item.tone,
        platforms: item.platforms,
        format: item.format,
        isEvergreen: item.isEvergreen,
        publishDate: item.publishDate,
        campaignId: item.campaignId,
        liveUrl: item.liveUrl,
        contentBody: item.contentBody,
        reach: item.reach,
        engagement: item.engagement,
        engagementRate: item.engagementRate,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }}
      initialContent={item.content}
    />
  );
}
