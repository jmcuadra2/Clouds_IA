////////////////////////////////////////////////////////////////////
// ONTOGENETIC MODEL FOR REAL-TIME VOLUMETRIC CLOUDS SIMULATION THESIS			
// Software Engineering and Computer Systems Deparment	
// National University for Distance Education (UNED)			    		
// Carlos Jim�nez de Parga, PhD student.
// License Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.
// Last revision 19/04/2019
//////////////////////////////////////////////////////////////////

#version 450 core
#pragma optimize(on)

//#define FULLMOON

#define SC (250.0)

// Declare uniforms

uniform sampler3D iNoise;
uniform sampler2D iChannel0;
uniform sampler3D iVoxel[10];
uniform float iDepth;
uniform int iNumSph;
uniform int iNumClouds;
uniform int iTurn;
uniform vec2 iResolution;
uniform vec2 iMouse;
uniform mat4 iView;
uniform vec3 iPos;
uniform vec3 iVmin[10];
uniform vec3 iVmax[10];
uniform float iNumVoxel;
uniform int iLowLimits[10];
uniform int iUpLimits[10];
uniform int iDebug;
uniform float iTime;
uniform vec3 iWindDirection;
uniform float iAlpha;
uniform bool iEvolute;
uniform bool iSnow;
uniform vec3 iSunDir;

// Global variables

vec3 cloudColor;         // Color of the cloud
vec3 sunColor;           // Light color
vec4 candidates[100];    // List of candidates
float kPhase;           // Phase function constant
float T;                // Light threshold
int n = 0;              // Number of candidates
vec3 rdNorm;            // Normalized ray-direction
vec3 skyColor;          // Color of the sky
float sunSize = 0.5;   // Sun radius
float tmin, tmax, tymin, tymax, tzmin, tzmax; // For Smits' algorithm

in vec2 fragCoord; // Fragment shader 2D coordinates
out vec4 FBColor;  // Returned frame buffer color

int vSrc, vDst;   // Source and destination meshes

// sky
vec3 getSkyColor(vec3 e) {
    e.y = max(e.y,0.0) + 0.2;
    return vec3(pow(0.9-e.y,2.0), 0.9-e.y, 0.6 + (0.9-e.y)*0.4);
}

// License Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.
// Created by S. Guillitte 2015
// Galaxy morphology based on http://iopscience.iop.org/0004-637X/783/2/138/pdf/0004-637X_783_2_138.pdf

const mat2 starM = mat2(0.8, 0.6, -0.6, 0.8);

float noise(in vec3 p)
{

	p *= 2.;
	float res = 0.;
	float f = 1.;
	for (int i = 0; i < 3; i++)
	{
		p.xy = starM * p.xy;
		p = p.zxy*f + .6;
		f *= 1.15;
		res += sin(p.y + 1.3*sin(1.2*p.x) + 1.7*sin(1.7*p.z));
	}
	return res / 3.;

}

float fbmgal(vec3 p) {

	p = p * 10.0;

	float f = 1.;
	float r = 0.0;
	for (int i = 1; i < 5; i++) {
		r += noise(p*(20. + 3.*f)) / f;
		p.xz *= starM;
		f += 1.;

	}
	return pow(abs(r), 4.);
}


/*

	Non physical based atmospheric scattering made by robobo1221
	Site: http://www.robobo1221.net/shaders
	Shadertoy: http://www.shadertoy.com/user/robobo1221

*/

const float pi = 3.14159265359;
const float invPi = 1.0 / pi;

const float zenithOffset = 0.16;
const float multiScatterPhase = 0.4;
const float density = 0.7;

const float anisotropicIntensity = 0.0; //Higher numbers result in more anisotropic scattering

const vec3 sunSetColor = vec3(0.39, 0.57, 1.0) * (1.0 + anisotropicIntensity); //Make sure one of the conponents is never 0.0

#define smooth(x) x*x*(3.0-2.0*x)
#define zenithDensity(x) density / pow(max(x - zenithOffset, 0.35e-2), 0.75)


vec3 getSkyAbsorption(vec3 x, float y) {

	vec3 absorption = x * -y;
	absorption = exp2(absorption) * 2.0;

	return absorption;
}



float getSunPoint(vec3 rd, vec3 sd) {
	return smoothstep(0.03, 0.026, 1.0 + dot(rd, sd) + 0.028)*50.0;
}

float getRayleigMultiplier(vec3 rd, vec3 sd) {
	return 1.0 + pow(1.0 - clamp(1.0 + dot(rd, sd) + 0.028, 0.0, 1.0), 2.0) * pi * 0.5;
}

float getMie(vec3 rd, vec3 sd) {
	float disk = clamp(1.0 - pow(1.0 + dot(rd, sd) + 0.028, 0.1), 0.0, 1.0);

	return disk * disk*(3.0 - 2.0 * disk) * 2.0 * pi;
}

vec3 getAtmosphericScattering(vec2 p, vec3 lp, vec3 rd) {
	vec3 correctedLp = lp;

	float zenith = zenithDensity(p.y);
	float sunPointDistMult = clamp(length(max(correctedLp.y + multiScatterPhase - zenithOffset, 0.0)), 0.0, 1.0);

	float rayleighMult = getRayleigMultiplier(rd, correctedLp);

	vec3 absorption = getSkyAbsorption(sunSetColor, zenith);
	vec3 sunAbsorption = getSkyAbsorption(sunSetColor, zenithDensity(correctedLp.y + multiScatterPhase));
	vec3 sky = sunSetColor * zenith * rayleighMult;
	vec3 sun = getSunPoint(rd, correctedLp) * absorption;
	vec3 mie = getMie(rd, correctedLp) * sunAbsorption;

	float grad = 1.0 - exp(-p.y * 3.0);

	vec3 totalSky = mix(sky * absorption, vec3(0.0), grad);

	totalSky += sun + mie;
	totalSky *= sunAbsorption * 0.5 + 0.5 * length(sunAbsorption);

	return totalSky;
}

vec3 jodieReinhardTonemap(vec3 c) {
	float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
	vec3 tc = c / (c + 1.0);

	return mix(c / (l + 1.0), tc, tc);
}


vec3 getSunset(in vec3 rd, in vec2 px)
{

	vec3 color = getAtmosphericScattering(px, iSunDir, rd) * pi;
	color = jodieReinhardTonemap(color);
	color = pow(color, vec3(2.2)); //Back to linear

	return color;


}

float diffuseSphere(vec3 rd, vec3 c, float r, vec3 l)
{
	float px = rd.x - c.x;
	float py = rd.y - c.y;
	float pz = rd.z - c.z;
	float sq = r * r - px * px - py * py - pz * pz;
	if (sq < 0)
	{
		return 0;
	}

	float z = sqrt(sq);
	vec3 normal = normalize(vec3(px, -py, z));
	float diffuse = max(0.0, dot(normal, l));
	return diffuse;
}


// Ellipsoid array

uniform iCloudPosBlock
{
	mat4 iCloudPos[500];
};

// Rodrigues' rotation array

uniform iCloudPosBlockR
{
	mat4 iCloudPosR[500];
};

// Calculate fBm noise

float fbm(in vec3 q)
{

	q = q - vec3(0.0, 0.1, 1.0)*iTime;

	float f = 0.0;
	float a = 0.5;

	for (int i = 0; i < 5; i++) {
		f += a * texture(iNoise, q / 256.0, -100.0).r;
		q = q * 2.0 + 0.03;
		a *= 0.5;
	}

	return f;

}

// Collision detection routine

void addCandidates(in vec3 rayOrg, in vec3 rayDir, int boundIdx)
{

	// Limits of the cloud ellipsoids

	int sphStart = iLowLimits[boundIdx];
	int sphEnd = iUpLimits[boundIdx];

	// Iterate over ellipsoids

	for (int j = sphStart; j < sphEnd; j++)
	{

		float cx = iCloudPos[j][0].x; // Ellipsoid position
		float cy = iCloudPos[j][0].y;
		float cz = iCloudPos[j][0].z;

		float a = iCloudPos[j][1].x; // Ellipsoid radius
		float b = iCloudPos[j][1].y;
		float c = iCloudPos[j][1].z;

		float x0 = rayOrg.x;
		float y0 = rayOrg.y;
		float z0 = rayOrg.z;

		float vx = rayDir.x;
		float vy = rayDir.y;
		float vz = rayDir.z;

		float k11, k12, k13, k21, k22, k23, k31, k32, k33;

    mat4 R = iCloudPosR[j];

		k11 = R[0].x;
		k12 = R[0].y;
		k13 = R[0].z;

		k21 = R[1].x;
		k22 = R[1].y;
		k23 = R[1].z;

		k31 = R[2].x;
		k32 = R[2].y;
		k33 = R[2].z;

		// Discriminant
		float disc = -(1.0 / (a*a)*pow(k11*vx + k12 * vy + k13 * vz, 2.0) + 1.0 / (b*b)*pow(k21*vx + k22 * vy + k23 * vz, 2.0) + 1.0 / (c*c)*pow(k31*vx + k32 * vy + k33 * vz, 2.0))*(1.0 / (a*a)*pow(k11*(cx - x0) + k12 * (cy - y0) + k13 * (cz - z0), 2.0) + 1.0 / (b*b)*pow(k21*(cx - x0) + k22 * (cy - y0) + k23 * (cz - z0), 2.0) + 1.0 / (c*c)*pow(k31*(cx - x0) + k32 * (cy - y0) + k33 * (cz - z0), 2.0) - 1.0) + pow(1.0 / (a*a)*(k11*vx*2.0 + k12 * vy*2.0 + k13 * vz*2.0)*(k11*(cx - x0) + k12 * (cy - y0) + k13 * (cz - z0)) + 1.0 / (b*b)*(k21*vx*2.0 + k22 * vy*2.0 + k23 * vz*2.0)*(k21*(cx - x0) + k22 * (cy - y0) + k23 * (cz - z0)) + 1.0 / (c*c)*(k31*vx*2.0 + k32 * vy*2.0 + k33 * vz*2.0)*(k31*(cx - x0) + k32 * (cy - y0) + k33 * (cz - z0)), 2.0)*(1.0 / 4.0);


		if (disc > 0) // There is a collision against the ellipsoid
		{
			float sqr = sqrt(disc);

			float num = (a*a)*(b*b)*cx*(k31*k31)*vx + (a*a)*(b*b)*cy*(k32*k32)*vy + (a*a)*(b*b)*cz*(k33*k33)*vz + (a*a)*(c*c)*cx*(k21*k21)*vx + (a*a)*(c*c)*cy*(k22*k22)*vy + (a*a)*(c*c)*cz*(k23*k23)*vz + (b*b)*(c*c)*cx*(k11*k11)*vx + (b*b)*(c*c)*cy*(k12*k12)*vy + (b*b)*(c*c)*cz*(k13*k13)*vz - (a*a)*(b*b)*(k31*k31)*vx*x0 - (a*a)*(c*c)*(k21*k21)*vx*x0 - (a*a)*(b*b)*(k32*k32)*vy*y0 - (b*b)*(c*c)*(k11*k11)*vx*x0 - (a*a)*(c*c)*(k22*k22)*vy*y0 - (a*a)*(b*b)*(k33*k33)*vz*z0 - (b*b)*(c*c)*(k12*k12)*vy*y0 - (a*a)*(c*c)*(k23*k23)*vz*z0 - (b*b)*(c*c)*(k13*k13)*vz*z0 + (a*a)*(b*b)*cx*k31*k32*vy + (a*a)*(b*b)*cy*k31*k32*vx + (a*a)*(b*b)*cx*k31*k33*vz + (a*a)*(b*b)*cz*k31*k33*vx + (a*a)*(b*b)*cy*k32*k33*vz + (a*a)*(b*b)*cz*k32*k33*vy + (a*a)*(c*c)*cx*k21*k22*vy + (a*a)*(c*c)*cy*k21*k22*vx + (a*a)*(c*c)*cx*k21*k23*vz + (a*a)*(c*c)*cz*k21*k23*vx + (a*a)*(c*c)*cy*k22*k23*vz + (a*a)*(c*c)*cz*k22*k23*vy + (b*b)*(c*c)*cx*k11*k12*vy + (b*b)*(c*c)*cy*k11*k12*vx + (b*b)*(c*c)*cx*k11*k13*vz + (b*b)*(c*c)*cz*k11*k13*vx + (b*b)*(c*c)*cy*k12*k13*vz + (b*b)*(c*c)*cz*k12*k13*vy - (a*a)*(b*b)*k31*k32*vy*x0 - (a*a)*(b*b)*k31*k33*vz*x0 - (a*a)*(b*b)*k31*k32*vx*y0 - (a*a)*(c*c)*k21*k22*vy*x0 - (a*a)*(c*c)*k21*k23*vz*x0 - (a*a)*(b*b)*k32*k33*vz*y0 - (a*a)*(c*c)*k21*k22*vx*y0 - (a*a)*(b*b)*k31*k33*vx*z0 - (b*b)*(c*c)*k11*k12*vy*x0 - (a*a)*(b*b)*k32*k33*vy*z0 - (b*b)*(c*c)*k11*k13*vz*x0 - (a*a)*(c*c)*k22*k23*vz*y0 - (b*b)*(c*c)*k11*k12*vx*y0 - (a*a)*(c*c)*k21*k23*vx*z0 - (a*a)*(c*c)*k22*k23*vy*z0 - (b*b)*(c*c)*k12*k13*vz*y0 - (b*b)*(c*c)*k11*k13*vx*z0 - (b*b)*(c*c)*k12*k13*vy*z0;
			float denom = (a*a)*(b*b)*(k31*k31)*(vx*vx) + (a*a)*(b*b)*(k32*k32)*(vy*vy) + (a*a)*(b*b)*(k33*k33)*(vz*vz) + (a*a)*(c*c)*(k21*k21)*(vx*vx) + (a*a)*(c*c)*(k22*k22)*(vy*vy) + (a*a)*(c*c)*(k23*k23)*(vz*vz) + (b*b)*(c*c)*(k11*k11)*(vx*vx) + (b*b)*(c*c)*(k12*k12)*(vy*vy) + (b*b)*(c*c)*(k13*k13)*(vz*vz) + (a*a)*(b*b)*k31*k32*vx*vy*2.0 + (a*a)*(b*b)*k31*k33*vx*vz*2.0 + (a*a)*(b*b)*k32*k33*vy*vz*2.0 + (a*a)*(c*c)*k21*k22*vx*vy*2.0 + (a*a)*(c*c)*k21*k23*vx*vz*2.0 + (a*a)*(c*c)*k22*k23*vy*vz*2.0 + (b*b)*(c*c)*k11*k12*vx*vy*2.0 + (b*b)*(c*c)*k11*k13*vx*vz*2.0 + (b*b)*(c*c)*k12*k13*vy*vz*2.0;
			float prefix = a * a*b*b*c*c*sqr;
			float t1 = (prefix + num) / denom;
			float t2 = -(prefix - num) / denom;

			float t, limit;

			if (t1 < t2) // Order collision points
			{
				t = t1;
				limit = t2;
			}
			else
			{
				t = t2;
				limit = t1;
			}

			// Add to candidates list
			candidates[n] = vec4(t, limit, j, boundIdx);
			n++;

		}
	}

}

// Insertion-sort algorithm

void order()
{
	int h;
	vec4 aux;

	for (int i = 1; i < n; i++)
	{
		aux = candidates[i];
		h = i - 1;
		while ((h >= 0) && (aux.x < candidates[h].x))
		{
			candidates[h + 1] = candidates[h];
			h--;
		}
		candidates[h + 1] = aux;
	}
}

// Simplified Henyey-Greenstein phase function

float phase(in float g)
{

	return 0.0795 * ((1.0 - g * g) / pow(1.0 + g * g - 2.0*g*dot(rdNorm, iSunDir), 1.5));

}

// Ray-trace pseudo-ellipsoid

vec4 trace(in vec3 rayOrg, in vec3 rayDir, in vec3 color)
{

	float localDen, den;

	float tIn, tOut;

	float t;

	t = candidates[0].x;

	for (int i = 0; i < n; i++)
	{

		int sphIdx = int(candidates[i].z);        // Ellipsoid index
		int boundIdx = int(candidates[i].w);      // Bounding box index
		vec3 cloudPos = iCloudPos[sphIdx][0].xyz; // Ellipsoid 3D position
		float radius = iCloudPos[sphIdx][2].x;

		// Bounding-boxes linear interpolation
		vec3 iVoxMin = mix(iVmin[vSrc], iVmin[vDst], iAlpha);
		vec3 iVoxMax = mix(iVmax[vSrc], iVmax[vDst], iAlpha);


		tIn = t;
		tOut = candidates[i].y;

		// Iterate pseudo-ellipsoid
		while (tIn <= tOut)
		{
			vec3  pos = rayOrg + tIn * rayDir; // Point in the straight line

			den = fbm(pos); // Density

			localDen = exp(-distance(pos, cloudPos) / radius);

			if (den < localDen) // Trace pseudo-ellipsoid
			{

				float deltaT = exp(-0.3*den);
				vec3 index = (pos - iVoxMin) / (iVoxMax - iVoxMin); //Voxel index

				// Interpolate bounding-boxes pre-computed light 
				float precLight = mix(texture(iVoxel[vSrc], index, -100.0).r, texture(iVoxel[vDst], index, -100.0).r, iAlpha);


				vec3 absorpLight = sunColor * precLight; // Absorption                                                           
				vec3 scatterLight = sunColor * phase(kPhase)*precLight; // Scattering
				vec3 totalLight = absorpLight * 0.9 + scatterLight; // Total light

				color += (1.0 - deltaT) * totalLight * T; // Color

        T *= deltaT; // Increment threshold

        if (T < 1e-6) // Exit condition
          return vec4(color, 1 - T);

		}
		tIn += 0.1; // Step ray-marching
	}

}

return vec4(color, 1 - T); // Return color with transparency
}

// Render cloud mesh

vec4 render(in vec3 rayOrg, in vec3 rayDir, in vec2 position, in vec4 resM)
{
	rdNorm = normalize(rayDir);

	// Background sky     
	vec4 skycol;
	vec4 res = vec4(0);

	float sun = 1.0 + dot(iSunDir, rdNorm);

	if (iTurn == 0) // Morning scene
	{
		float fexp = exp(-sun * 1000.0 / sunSize);
		float fexp2 = exp(-sun * 1000.0 / 0.1);

		skycol = vec4(0.2*sunColor*fexp + 0.6*sunColor*fexp2, 1.0);
		// sun glare    
		skycol += vec4(getSkyColor(rdNorm.xyz) + 0.2*sunColor*exp(-sun), 0);

	}

	else if (iTurn == 1) // Sunset scene
	{

		vec3 stars;

		if ((rdNorm.y > 0.1) && (dot(iSunDir, rdNorm) > -0.995))
		{
			// Create stars
			float g = 0.2*fbmgal(rdNorm);
			stars = 0.3*vec3(g*g*g, g*g*1.3, 8.5*g);
			if (length(stars) < 2.4)
				stars = vec3(0);
		}

		// sun glare    
		skycol = vec4(getSunset(rdNorm, position) + 0.2*sunColor*exp(-sun) + stars, 1.0);

		resM.xyz = resM.xyz / 5.0; // Mountain darkness

	}
	else // Night scene
	{
		vec3  stars = vec3(0);


		if ((dot(iSunDir, rdNorm) > -0.9988))
		{
			// Create stars
			float g = 0.2*fbmgal(rdNorm);
			stars = 0.3*vec3(g*g*g, g*g*1.3, 1.5*g);
		}

#ifdef FULLMOON
   // Black moon by DeMaCia
   // License Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.

		float fexp = exp(-sun * 1000.0 / sunSize);
		float fexp2 = exp(-sun * 1000.0 / 0.2);


		skycol = vec4(0.2*sunColor*fexp + sunColor * fexp2, 1.0);
		// moon glare    
		skycol += vec4(0.2*sunColor*exp(-sun) + stars, 0);

#else

		float time = 812.81;


		//Diffuse
		float r = 0.05;
		vec3 vp = vec3(sin(time*0.2), cos(time*0.2), sin(time*0.2));
		vec3 vl = normalize(vp);
		float diffuse = diffuseSphere(rdNorm, -iSunDir, r, vl);

		skycol = vec4(vec3(diffuse) + stars, 1);
#endif

		resM.xyz = resM.xyz / 8.0; // Mountain darkness
	}

	// Smits' algorithm   


	float vminX = iVmin[2].x;
	float vmaxX = iVmax[2].x;
	float vminY = iVmin[2].y;
	float vmaxY = iVmax[2].y;
	float vminZ = iVmin[2].z;
	float vmaxZ = iVmax[2].z;

	bool flag = true;

	if (rayDir.x >= 0)
	{
		tmin = (vminX - rayOrg.x) / rayDir.x;
		tmax = (vmaxX - rayOrg.x) / rayDir.x;
	}
	else
	{
		tmin = (vmaxX - rayOrg.x) / rayDir.x;
		tmax = (vminX - rayOrg.x) / rayDir.x;
	}
	if (rayDir.y >= 0)
	{
		tymin = (vminY - rayOrg.y) / rayDir.y;
		tymax = (vmaxY - rayOrg.y) / rayDir.y;
	}
	else
	{
		tymin = (vmaxY - rayOrg.y) / rayDir.y;
		tymax = (vminY - rayOrg.y) / rayDir.y;
	}

	if ((tmin > tymax) || (tymin > tmax))
		flag = false;

	if (tymin > tmin)
		tmin = tymin;

	if (tymax < tmax)
		tmax = tymax;

	if (rayDir.z >= 0)
	{
		tzmin = (vminZ - rayOrg.z) / rayDir.z;
		tzmax = (vmaxZ - rayOrg.z) / rayDir.z;
	}
	else
	{
		tzmin = (vmaxZ - rayOrg.z) / rayDir.z;
		tzmax = (vminZ - rayOrg.z) / rayDir.z;
	}

	if ((tmin > tzmax) || (tzmin > tmax))
		flag = false;

	// clouds    
	if (flag)
		addCandidates(rayOrg, rayDir, 0);

	if (n > 0 && resM.w < 0.0) // No mountain collision
	{
		T = 1.0;
		order();
		vec3 color = vec3(0.0);
		res = trace(rayOrg, rayDir, color);

		return vec4((T == 1.0) ? skycol : res + skycol * T);
	}
	else if (n > 0 && resM.w > 0.0) // Mountain collision
	{
		T = 1.0;
		order();
		vec3 color = vec3(0.0);
		res = trace(rayOrg, rayDir, color);
		return vec4((T == 1.0) ? resM : resM * T + res);
	}
	else if (n == 0 && resM.w < 0.0)
		return skycol;
	else if (n == 0 && resM.w > 0.0)
		return resM;

}


void main()
{

	// Change coordinate system
	vec2 p = (-iResolution.xy + 2.0*fragCoord.xy) / iResolution.y;
	// ray

	vec2 position = fragCoord.xy / iResolution.x;

	switch (iTurn)
	{
	case 0:
		// MORNING

		sunColor = vec3(1.0, 1.0, 1.0);
		kPhase = -0.3;

		break;

	case 1:
		// SUNSET
		sunColor = vec3(1.0, 0.8, 0.2);
		kPhase = -0.4;
		break;
	case 2:
		// NIGHT
		sunColor = vec3(0.9, 0.9, 0.9);
		kPhase = -0.4;

		break;
	}

	// Select either mesh evolution or involution
	if (iEvolute)
	{
		vSrc = 0;
		vDst = 1;
	}
	else
	{
		vSrc = 1;
		vDst = 0;
	}

	vec4 rayDir = iView * normalize(vec4(p, 1.5, 1));

	vec4 res = renderMountains(iPos*iDepth * 500 + terrainL(iPos.xz) + 19.0*SC, rayDir.xyz);

	// Frame-buffer return color
	FBColor = render(iPos, rayDir.xyz, position, res);

}

