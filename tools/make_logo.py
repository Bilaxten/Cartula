# Regenerate from the repo root: python tools/make_logo.py  (writes assets/logo.svg)
# Isometric voxel island, colours only from the map palette (biome.js + accent).
HW, HH, ZU = 5.0, 2.5, 5.0          # tile half-width, half-height, level height
N = 6                               # 6x6 grid, outer ring is sea
LV = [
 [0,0,0,0,0,0],
 [0,1,1,2,1,0],
 [0,1,2,3,2,0],
 [0,2,3,4,2,0],
 [0,1,2,2,1,0],
 [0,0,0,0,0,0]]
TOP = {1:'#d9c48f', 2:'#9cbd63', 3:'#4f7f42', 4:'#e07a4a'}   # beach, grassland, forest, accent
def shade(h,k):
    r,g,b=(int(h[i:i+2],16) for i in (1,3,5))
    return '#%02x%02x%02x'%(round(r*k),round(g*k),round(b*k))
X0, Y0 = 32.0, 17.0
def pt(i,j,z): return (X0+(i-j)*HW, Y0+(i+j)*HH - z*ZU)
def poly(ps,fill): return '<path fill="%s" d="M%s Z"/>'%(fill,' L'.join('%g %g'%(round(x,2),round(y,2)) for x,y in ps))
out=[]
# sea slab: top face + two side faces, 1 level thick
a,b,c,d = pt(0,0,0), pt(N,0,0), pt(N,N,0), pt(0,N,0)
dn=lambda p:(p[0],p[1]+ZU)
out.append(poly([d,c,dn(c),dn(d)],'#1b3a5c'))                 # front-left side (deep sea)
out.append(poly([c,b,dn(b),dn(c)],shade('#1b3a5c',0.8)))
out.append(poly([a,b,c,d],'#2f6690'))                         # shallow sea top
cells=sorted(((i,j) for i in range(N) for j in range(N) if LV[j][i]>0), key=lambda t:(t[0]+t[1],t[0]))
for i,j in cells:
    z=LV[j][i]; col=TOP[z]
    t=pt(i,j,z); r=pt(i+1,j,z); btm=pt(i+1,j+1,z); l=pt(i,j+1,z)
    base=lambda p:(p[0],p[1]+z*ZU)
    out.append(poly([l,btm,base(btm),base(l)],shade(col,0.78)))
    out.append(poly([btm,r,base(r),base(btm)],shade(col,0.62)))
    out.append(poly([t,r,btm,l],col))
svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="StilizedMaps">\n<title>StilizedMaps</title>\n'+'\n'.join(out)+'\n</svg>\n'
open('assets/logo.svg','w',newline='\n').write(svg)
print(len(svg))
