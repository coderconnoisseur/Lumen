// Landing page photography and the hero sky video, all from Pexels (free for commercial use, no attribution
// required), stored in public/home/:
//   sky.mp4      pexels.com/video/10452770 (720p)     poppies.jpg  pexels.com/photo/9391709
//   meadow.jpg   pexels.com/photo/167570               dune.jpg     pexels.com/photo/27990818
//   daisies.jpg  pexels.com/photo/37596897             fields.jpg   pexels.com/photo/37047484
import Image from "next/image";

const PHOTOS = {
	poppies: "/home/poppies.jpg",
	meadow: "/home/meadow.jpg",
	dune: "/home/dune.jpg",
	daisies: "/home/daisies.jpg",
	fields: "/home/fields.jpg",
} as const;

export type PhotoName = keyof typeof PHOTOS;

/** A photo that fills its (rounded) parent, slightly darkened so white text stays readable. */
export function Photo({ name, sizes = "(min-width: 1024px) 50vw, 100vw" }: { name: PhotoName; sizes?: string }) {
	return (
		<div aria-hidden className="absolute inset-0">
			<Image src={PHOTOS[name]} alt="" fill sizes={sizes} className="object-cover" />
			<div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(0_0_0/0.25),rgb(0_0_0/0.05)_45%,rgb(0_0_0/0.35))]" />
		</div>
	);
}
