import type { SVGProps } from "react";

export function BrandMark({ title, ...props }: SVGProps<SVGSVGElement> & { title?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={24} height={24} viewBox="0 0 32 32" fill="currentColor" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title} {...props}>
            {title ? <title>{title}</title> : null}
            <path fillRule="evenodd" d="M4 4.5h4.5L16 12l7.5-7.5H28v23h-7V16l-5 5-5-5v11.5H4V4.5Zm18.5 7.5v8l4.5-4-4.5-4Z" />
        </svg>
    );
}
