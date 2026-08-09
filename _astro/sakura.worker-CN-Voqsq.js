(function() {
	let a = null, n = null, c = null, u = null, m = null, x = null, h = 0, d = 0, y = !1, p = !1;
	function s(t, i) {
		switch (t) {
			case "x": return Math.random() * h;
			case "y": return Math.random() * d;
			case "s": return i.size.min + Math.random() * (i.size.max - i.size.min);
			case "r": return Math.random() * 6;
			case "a": return i.opacity.min + Math.random() * (i.opacity.max - i.opacity.min);
			case "fnx": {
				const e = i.speed.horizontal.min + Math.random() * (i.speed.horizontal.max - i.speed.horizontal.min);
				return (r, o) => r + e;
			}
			case "fny": {
				const e = i.speed.vertical.min + Math.random() * (i.speed.vertical.max - i.speed.vertical.min);
				return (r, o) => o + e;
			}
			case "fnr": return (e) => e + i.speed.rotation;
			case "fna": return (e) => e - i.speed.fadeSpeed * .01;
			default: return;
		}
	}
	var A = class {
		x;
		y;
		s;
		r;
		a;
		fn;
		idx;
		img;
		limitArray;
		config;
		constructor(t, i, e, r, o, f, w, E, _, F) {
			this.x = t, this.y = i, this.s = e, this.r = r, this.a = o, this.fn = f, this.idx = w, this.img = E, this.limitArray = _, this.config = F;
		}
		draw(t) {
			t.save(), t.translate(this.x, this.y), t.rotate(this.r), t.globalAlpha = this.a, t.drawImage(this.img, 0, 0, 40 * this.s, 40 * this.s), t.restore();
		}
		update() {
			this.x = this.fn.x(this.x, this.y), this.y = this.fn.y(this.x, this.y), this.r = this.fn.r(this.r), this.a = this.fn.a(this.a), (this.x > h || this.x < 0 || this.y > d || this.y < 0 || this.a <= 0) && (this.limitArray[this.idx] === -1 ? this.resetPosition() : this.limitArray[this.idx] > 0 && (this.resetPosition(), this.limitArray[this.idx]--));
		}
		resetPosition() {
			Math.random() > .4 ? (this.x = s("x", this.config), this.y = 0, this.s = s("s", this.config), this.r = s("r", this.config), this.a = s("a", this.config)) : (this.x = h, this.y = s("y", this.config), this.s = s("s", this.config), this.r = s("r", this.config), this.a = s("a", this.config));
		}
	}, M = class {
		list = [];
		push(t) {
			this.list.push(t);
		}
		update() {
			for (let t = 0, i = this.list.length; t < i; t++) this.list[t].update();
		}
		draw(t) {
			for (let i = 0, e = this.list.length; i < e; i++) this.list[i].draw(t);
		}
	};
	async function b() {
		const t = await fetch("/assets/images/effects/sakura.png");
		if (!t.ok) throw new Error(`Failed to load sakura image: ${t.status} ${t.statusText}`);
		const i = await t.blob();
		return createImageBitmap(i);
	}
	function z(t, i) {
		const e = n;
		if (!e) throw new Error("Canvas 2D context not initialized");
		const r = new M(), o = new Array(t.sakuraNum).fill(t.limitTimes);
		for (let f = 0; f < t.sakuraNum; f++) {
			const w = new A(s("x", t), s("y", t), s("s", t), s("r", t), s("a", t), {
				x: s("fnx", t),
				y: s("fny", t),
				r: s("fnr", t),
				a: s("fna", t)
			}, f, i, o, t);
			w.draw(e), r.push(w);
		}
		return r;
	}
	function g() {
		if (!n || !a || !c) return;
		const t = () => {
			if (!(!n || !a || !c)) try {
				n.clearRect(0, 0, a.width, a.height), c.update(), c.draw(n), u = requestAnimationFrame(t);
			} catch (i) {
				l("animate loop", i), k();
			}
		};
		u = requestAnimationFrame(t);
	}
	function k() {
		u !== null && (cancelAnimationFrame(u), u = null);
	}
	function S() {
		n && a && n.clearRect(0, 0, a.width, a.height);
	}
	function v() {
		if (k(), S(), m) {
			try {
				m.close();
			} catch {}
			m = null;
		}
		c = null, n = null, a = null, x = null, y = !1;
	}
	function l(t, i) {
		const e = i instanceof Error ? `${t}: ${i.message}` : `${t}: ${String(i)}`, r = i instanceof Error ? i.stack : void 0;
		self.postMessage({
			type: "error",
			message: e,
			stack: r
		});
	}
	async function $(t) {
		switch (t.type) {
			case "init":
				try {
					x = t.config, a = t.canvas, h = t.width, d = t.height, a.width = h, a.height = d, n = a.getContext("2d"), m = await b(), c = z(x, m), y = !0, p || g(), self.postMessage({ type: "ready" });
				} catch (i) {
					l("init", i), v();
				}
				break;
			case "start":
				try {
					if (!y || p) return;
					g();
				} catch (i) {
					l("start", i);
				}
				break;
			case "stop":
				try {
					v();
				} catch (i) {
					l("stop", i);
				}
				break;
			case "resize":
				try {
					h = t.width, d = t.height, a && (a.width = h, a.height = d);
				} catch (i) {
					l("resize", i);
				}
				break;
			case "visibilitychange":
				try {
					p = t.hidden, p ? k() : y && u === null && g();
				} catch (i) {
					l("visibilitychange", i);
				}
				break;
			default:
		}
	}
	self.onmessage = (t) => {
		try {
			$(t.data);
		} catch (i) {
			l("onmessage", i);
		}
	}, self.onerror = (t, i, e, r, o) => (self.postMessage({
		type: "error",
		message: String(t),
		stack: o?.stack
	}), !0), self.onmessageerror = (t) => {
		self.postMessage({
			type: "messageError",
			message: `message deserialization error: ${String(t)}`
		});
	};
})();
