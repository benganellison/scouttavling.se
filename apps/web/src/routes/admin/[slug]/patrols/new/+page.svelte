<script lang="ts">
	import '#lib/ui/patrols/prep.css';
	import PatrolForm from '#lib/ui/patrols/PatrolForm.svelte';
	import type { PatrolFormData } from '#lib/ui/patrols/labels.ts';

	let { data, form } = $props();

	const initial = $derived<PatrolFormData>(
		(form?.values as PatrolFormData | undefined) ?? {
			name: '',
			number: data.nextNumber,
			trackId: data.tracks[0]?.id ?? '',
			troop: '',
			contactName: '',
			contactPhone: '',
			contactEmail: '',
			contactMemberNo: '',
			paid: false,
			status: 'registered',
			members: []
		}
	);
</script>

<svelte:head><title>Ny patrull · {data.competition.name}</title></svelte:head>

<div class="prep narrow">
	<header class="prep-head">
		<div>
			<a class="back" href="/admin/{data.competition.slug}/patrols">← Patruller</a>
			<h1>Lägg till patrull</h1>
		</div>
	</header>
	<PatrolForm {initial} tracks={data.tracks} errors={form?.errors ?? {}} submitLabel="Lägg till patrull" cancelHref="/admin/{data.competition.slug}/patrols" />
</div>

<style>
	.narrow {
		max-width: 960px;
	}
	.back {
		font-weight: 700;
		text-decoration: none;
		font-size: 14px;
	}
</style>
