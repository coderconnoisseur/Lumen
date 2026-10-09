// Landing page photography and the hero sky video, all from Pexels (free for commercial use, no attribution
// required), stored in public/home/:
//   sky.mp4      pexels.com/video/10452770 (1080p, first frame trimmed; sky-poster.jpg is a still from it)     poppies.jpg  pexels.com/photo/9391709
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

/** A photo that fills its (rounded) parent, darkened so white text stays readable. `soft` throws it out of focus
 *  and darkens the middle, for sections with a lot of text over a busy photo. */
export function Photo({ name, sizes = "(min-width: 1024px) 50vw, 100vw", soft = false }: {
	name: PhotoName;
	sizes?: string;
	soft?: boolean;
}) {
	return (
		<div aria-hidden className="absolute inset-0 overflow-hidden">
			<Image src={PHOTOS[name]} alt="" fill sizes={sizes} className={soft ? "scale-110 object-cover blur-[7px]" : "object-cover"} />
			<div
				className="absolute inset-0"
				style={{
					background: soft
						? "radial-gradient(60% 55% at 50% 50%, rgb(0 0 0 / 0.5), rgb(0 0 0 / 0.2) 70%, rgb(0 0 0 / 0.3))"
						: "linear-gradient(180deg, rgb(0 0 0 / 0.25), rgb(0 0 0 / 0.05) 45%, rgb(0 0 0 / 0.35))",
				}}
			/>
		</div>
	);
}
